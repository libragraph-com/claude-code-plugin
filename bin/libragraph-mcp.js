#!/usr/bin/env node

/**
 * LibRAGraph MCP stdio proxy.
 *
 * Reads JSON-RPC from stdin, forwards to a vault HTTP MCP endpoint,
 * writes responses to stdout. This is the stdio transport wrapper that
 * makes vault MCP work with Claude Code, Claude Desktop, and any
 * MCP client that supports stdio servers.
 *
 * Environment variables:
 *   LIBRAGRAPH_URL    — vault MCP endpoint (default: http://localhost:8080/mcp)
 *   LIBRAGRAPH_TOKEN  — PAT token (lvt_...)
 *
 * Usage:
 *   LIBRAGRAPH_TOKEN=lvt_abc123 libragraph-mcp
 *   LIBRAGRAPH_URL=https://kevin.gw.libragraph.com/mcp LIBRAGRAPH_TOKEN=lvt_abc123 libragraph-mcp
 */

const url = process.env.LIBRAGRAPH_URL || 'http://localhost:8080/mcp';
const token = process.env.LIBRAGRAPH_TOKEN;

if (!token) {
  process.stderr.write('Error: LIBRAGRAPH_TOKEN environment variable is required.\n');
  process.stderr.write('Create a token: lg token create --name claude-mcp --scope read,search\n');
  process.exit(1);
}

let sessionId = null;
let pending = 0;
let stdinEnded = false;

async function processStdin() {
  const readline = await import('node:readline');
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      pending++;
      handleMessage(trimmed).finally(() => {
        pending--;
        if (stdinEnded && pending === 0) process.exit(0);
      });
    }
  }
  stdinEnded = true;
  if (pending === 0) process.exit(0);
}

processStdin();

async function handleMessage(line) {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    // Not valid JSON — ignore
    return;
  }

  try {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Authorization': `Bearer ${token}`,
    };
    if (sessionId) {
      headers['Mcp-Session-Id'] = sessionId;
    }

    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
    });

    // Capture session ID from first response
    const sid = resp.headers.get('Mcp-Session-Id');
    if (sid) {
      sessionId = sid;
    }

    const contentType = resp.headers.get('Content-Type') || '';

    if (contentType.includes('text/event-stream')) {
      // SSE response — parse events and forward JSON-RPC messages
      const text = await resp.text();
      for (const line of text.split('\n')) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data.length > 0) {
            process.stdout.write(data + '\n');
          }
        }
      }
    } else {
      // Regular JSON response
      const body = await resp.text();
      if (body.length > 0) {
        process.stdout.write(body + '\n');
      }
    }
  } catch (err) {
    // Network error — return JSON-RPC error
    const errorResponse = {
      jsonrpc: '2.0',
      id: request.id ?? null,
      error: {
        code: -32000,
        message: `Vault connection failed: ${err.message}`,
      },
    };
    process.stdout.write(JSON.stringify(errorResponse) + '\n');
  }
}
