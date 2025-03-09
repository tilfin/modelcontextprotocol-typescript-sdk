import process from "node:process";
import { Readable, Writable } from "node:stream";
import { ReadBuffer, serializeMessage } from "../shared/read-buffer.js";
import { JSONRPCRequest } from "../types.js";
import { Transport, TransportRPCCallback } from "../shared/transport.js";

/**
 * Server transport for stdio: this communicates with a MCP client by reading from the current process' stdin and writing to stdout.
 *
 * This transport is only available in Node.js environments.
 */
export class StdioServerTransport implements Transport {
  private _readBuffer: ReadBuffer = new ReadBuffer();
  private _started = false;
  private _callbackMap = new Map<string | number, TransportRPCCallback>();

  constructor(
    private _stdin: Readable = process.stdin,
    private _stdout: Writable = process.stdout,
  ) {
    this._callbackMap = new Map();
  }

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (request: JSONRPCRequest, callback: TransportRPCCallback) => void;

  // Arrow functions to bind `this` properly, while maintaining function identity.
  _ondata = (chunk: Buffer) => {
    this._readBuffer.append(chunk);
    this.processReadBuffer();
  };
  _onerror = (error: Error) => {
    this.onerror?.(error);
  };

  /**
   * Starts listening for messages on stdin.
   */
  async start(): Promise<void> {
    if (this._started) {
      throw new Error(
        "StdioServerTransport already started! If using Server class, note that connect() calls start() automatically.",
      );
    }

    this._started = true;
    this._stdin.on("data", this._ondata);
    this._stdin.on("error", this._onerror);
  }

  private processReadBuffer() {
    while (true) {
      try {
        const message = this._readBuffer.readMessage();
        if (message === null) {
          break;
        }

        if ('id' in message && 'method' in message) {
          this.onmessage?.(message as JSONRPCRequest, (response) => {
            this._callbackMap.get(response.id)?.(response);
            this._callbackMap.delete(response.id);
          });
        }
      } catch (error) {
        this.onerror?.(error as Error);
      }
    }
  }

  async close(): Promise<void> {
    // Remove our event listeners first
    this._stdin.off("data", this._ondata);
    this._stdin.off("error", this._onerror);

    // Check if we were the only data listener
    const remainingDataListeners = this._stdin.listenerCount('data');
    if (remainingDataListeners === 0) {
      // Only pause stdin if we were the only listener
      // This prevents interfering with other parts of the application that might be using stdin
      this._stdin.pause();
    }
    
    // Clear the buffer and notify closure
    this._readBuffer.clear();
    this._callbackMap.clear();
    this.onclose?.();
  }

  send(request: JSONRPCRequest, callback: TransportRPCCallback): void {
    this._callbackMap.set(request.id, callback);

    const json = serializeMessage(request);
    if (this._stdout.write(json)) {
    } else {
      this._stdout.once("drain", () => {});
    }
  }
}
