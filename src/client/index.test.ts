/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable no-constant-binary-expression */
/* eslint-disable @typescript-eslint/no-unused-expressions */
import { Client } from "./index.js";
import { z } from "zod";
import {
  RequestSchema,
  NotificationSchema,
  ResultSchema,
  LATEST_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  InitializeRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  CreateMessageRequestSchema,
  ListRootsRequestSchema,
  ErrorCode,
} from "../types.js";
import { Transport } from "../shared/transport.js";
import { Server } from "../server/index.js";
import { InMemoryTransport } from "../transport/inMemory.js";

test("should initialize with matching protocol version", async () => {
  const clientTransport: Transport = {
    start: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockImplementation((message) => {
      if (message.method === "initialize") {
        clientTransport.onmessage?.({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: LATEST_PROTOCOL_VERSION,
            capabilities: {},
            serverInfo: {
              name: "test",
              version: "1.0",
            },
            instructions: "test instructions",
          },
        });
      }
      return Promise.resolve();
    }),
  };

  const client = new Client(
    {
      name: "test client",
      version: "1.0",
    },
    {
      capabilities: {
        sampling: {},
      },
    },
  );

  await client.connect(clientTransport);

  // Should have sent initialize with latest version
  expect(clientTransport.send).toHaveBeenCalledWith(
    expect.objectContaining({
      method: "initialize",
      params: expect.objectContaining({
        protocolVersion: LATEST_PROTOCOL_VERSION,
      }),
    }),
  );

  // Should have the instructions returned
  expect(client.getInstructions()).toEqual("test instructions");
});

test("should initialize with supported older protocol version", async () => {
  const OLD_VERSION = SUPPORTED_PROTOCOL_VERSIONS[1];
  const clientTransport: Transport = {
    start: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockImplementation((message) => {
      if (message.method === "initialize") {
        clientTransport.onmessage?.({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: OLD_VERSION,
            capabilities: {},
            serverInfo: {
              name: "test",
              version: "1.0",
            },
          },
        });
      }
      return Promise.resolve();
    }),
  };

  const client = new Client(
    {
      name: "test client",
      version: "1.0",
    },
    {
      capabilities: {
        sampling: {},
      },
    },
  );

  await client.connect(clientTransport);

  // Connection should succeed with the older version
  expect(client.getServerVersion()).toEqual({
    name: "test",
    version: "1.0",
  });

  // Expect no instructions
  expect(client.getInstructions()).toBeUndefined();
});

test("should reject unsupported protocol version", async () => {
  const clientTransport: Transport = {
    start: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockImplementation((message) => {
      if (message.method === "initialize") {
        clientTransport.onmessage?.({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: "invalid-version",
            capabilities: {},
            serverInfo: {
              name: "test",
              version: "1.0",
            },
          },
        });
      }
      return Promise.resolve();
    }),
  };

  const client = new Client(
    {
      name: "test client",
      version: "1.0",
    },
    {
      capabilities: {
        sampling: {},
      },
    },
  );

  await expect(client.connect(clientTransport)).rejects.toThrow(
    "Server's protocol version is not supported: invalid-version",
  );

  expect(clientTransport.close).toHaveBeenCalled();
});

test("should respect server capabilities", async () => {
  const server = new Server(
    {
      name: "test server",
      version: "1.0",
    },
    {
      capabilities: {
        resources: {},
        tools: {},
      },
    },
  );

  server.setRequestHandler(InitializeRequestSchema, (_request) => ({
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities: {
      resources: {},
      tools: {},
    },
    serverInfo: {
      name: "test",
      version: "1.0",
    },
  }));

  server.setRequestHandler(ListResourcesRequestSchema, () => ({
    resources: [],
  }));

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [],
  }));

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  const client = new Client(
    {
      name: "test client",
      version: "1.0",
    },
    {
      capabilities: {
        sampling: {},
      },
    },
  );

  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);

  // Server supports resources and tools, but not prompts
  expect(client.getServerCapabilities()).toEqual({
    resources: {},
    tools: {},
  });

  // These should work
  await expect(client.listResources()).resolves.not.toThrow();
  await expect(client.listTools()).resolves.not.toThrow();

  // This should throw because prompts are not supported
  await expect(client.listPrompts()).rejects.toThrow(
    "Server does not support prompts",
  );
});


test("should only allow setRequestHandler for declared capabilities", () => {
  const client = new Client(
    {
      name: "test client",
      version: "1.0",
    },
    {
      capabilities: {
        sampling: {},
      },
    },
  );

  // This should work because sampling is a declared capability
  expect(() => {
    client.setRequestHandler(CreateMessageRequestSchema, () => ({
      model: "test-model",
      role: "assistant",
      content: {
        type: "text",
        text: "Test response",
      },
    }));
  }).not.toThrow();

  // This should throw because roots listing is not a declared capability
  expect(() => {
    client.setRequestHandler(ListRootsRequestSchema, () => ({}));
  }).toThrow("Client does not support roots capability");
});

/*
  Test that custom request/notification/result schemas can be used with the Client class.
  */
test("should typecheck", () => {
  const GetWeatherRequestSchema = RequestSchema.extend({
    method: z.literal("weather/get"),
    params: z.object({
      city: z.string(),
    }),
  });

  const GetForecastRequestSchema = RequestSchema.extend({
    method: z.literal("weather/forecast"),
    params: z.object({
      city: z.string(),
      days: z.number(),
    }),
  });

  const WeatherForecastNotificationSchema = NotificationSchema.extend({
    method: z.literal("weather/alert"),
    params: z.object({
      severity: z.enum(["warning", "watch"]),
      message: z.string(),
    }),
  });

  const WeatherRequestSchema = GetWeatherRequestSchema.or(
    GetForecastRequestSchema,
  );
  const WeatherNotificationSchema = WeatherForecastNotificationSchema;
  const WeatherResultSchema = ResultSchema.extend({
    temperature: z.number(),
    conditions: z.string(),
  });

  type WeatherRequest = z.infer<typeof WeatherRequestSchema>;
  type WeatherNotification = z.infer<typeof WeatherNotificationSchema>;
  type WeatherResult = z.infer<typeof WeatherResultSchema>;

  // Create a typed Client for weather data
  const weatherClient = new Client<
    WeatherRequest,
    WeatherNotification,
    WeatherResult
  >(
    {
      name: "WeatherClient",
      version: "1.0.0",
    },
    {
      capabilities: {
        sampling: {},
      },
    },
  );

  // Typecheck that only valid weather requests/notifications/results are allowed
  false &&
    weatherClient.request(
      {
        method: "weather/get",
        params: {
          city: "Seattle",
        },
      },
      WeatherResultSchema,
    );
});

test("should handle client cancelling a request", async () => {
  const server = new Server(
    {
      name: "test server",
      version: "1.0",
    },
    {
      capabilities: {
        resources: {},
      },
    },
  );

  // Set up server to delay responding to listResources
  server.setRequestHandler(
    ListResourcesRequestSchema,
    async (request, extra) => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return {
        resources: [],
      };
    },
  );

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  const client = new Client(
    {
      name: "test client",
      version: "1.0",
    },
    {
      capabilities: {},
    },
  );

  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);

  // Set up abort controller
  const controller = new AbortController();

  // Issue request but cancel it immediately
  const listResourcesPromise = client.listResources(undefined, {
    signal: controller.signal,
  });
  controller.abort("Cancelled by test");

  // Request should be rejected
  await expect(listResourcesPromise).rejects.toBe("Cancelled by test");
});

test("should handle request timeout", async () => {
  const server = new Server(
    {
      name: "test server",
      version: "1.0",
    },
    {
      capabilities: {
        resources: {},
      },
    },
  );

  // Set up server with a delayed response
  server.setRequestHandler(
    ListResourcesRequestSchema,
    async (_request, extra) => {
      const timer = new Promise((resolve) => {
        const timeout = setTimeout(resolve, 100);
        extra.signal.addEventListener("abort", () => clearTimeout(timeout));
      });

      await timer;
      return {
        resources: [],
      };
    },
  );

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  const client = new Client(
    {
      name: "test client",
      version: "1.0",
    },
    {
      capabilities: {},
    },
  );

  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);

  // Request with 0 msec timeout should fail immediately
  await expect(
    client.listResources(undefined, { timeout: 0 }),
  ).rejects.toMatchObject({
    code: ErrorCode.RequestTimeout,
  });
});
