import { Transport } from "../shared/transport.js";
import { JSONRPCError, JSONRPCMessage, JSONRPCResponse } from "../types.js";

/**
 * In-memory transport for creating clients and servers that talk to each other within the same process.
 */
export class InMemoryTransport implements Transport {
  private _otherTransport?: InMemoryTransport;
  private _messageQueue: JSONRPCMessage[] = [];

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage, callback: (response: JSONRPCResponse | JSONRPCError) => void) => void;

  /**
   * Creates a pair of linked in-memory transports that can communicate with each other. One should be passed to a Client and one to a Server.
   */
  static createLinkedPair(): [InMemoryTransport, InMemoryTransport] {
    const clientTransport = new InMemoryTransport();
    const serverTransport = new InMemoryTransport();
    clientTransport._otherTransport = serverTransport;
    serverTransport._otherTransport = clientTransport;
    return [clientTransport, serverTransport];
  }

  async start(): Promise<void> {}

  async close(): Promise<void> {}

  async send(message: JSONRPCMessage, callback: (response: JSONRPCResponse | JSONRPCError) => void): Promise<void> {
    if (!this._otherTransport) {
      throw new Error("Not connected");
    }

    if (this._otherTransport.onmessage) {
      this._otherTransport.onmessage(message, callback);
    } else {
      this._otherTransport._messageQueue.push(message);
    }
  }
}
