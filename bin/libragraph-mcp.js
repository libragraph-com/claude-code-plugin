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
 *   LIBRAGRAPH_DEBUG  — set to "1" to log to /tmp/libragraph-mcp.log
 */

import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const url = process.env.LIBRAGRAPH_URL || 'http://localhost:8080/mcp';
const token = process.env.LIBRAGRAPH_TOKEN;
const debug = process.env.LIBRAGRAPH_DEBUG === '1';

function log(msg) {
  if (debug) {
    appendFileSync('/tmp/libragraph-mcp.log', new Date().toISOString() + ' ' + msg + '\n');
  }
}

if (!token) {
  process.stderr.write('Error: LIBRAGRAPH_TOKEN environment variable is required.\n');
  process.stderr.write('Create a token: lg token create --name claude-mcp --scope read,search\n');
  process.exit(1);
}

let sessionId = null;

/**
 * Sanitize MCP responses to fix Quarkus-generated quirks:
 * - Remove null values from tool annotations (title: null)
 * - Remove empty required arrays (required: [])
 */
function sanitizeResponse(body, method) {
  if (method !== 'tools/list') return body;
  try {
    const parsed = JSON.parse(body);
    const tools = parsed?.result?.tools;
    if (!Array.isArray(tools)) return body;
    for (const tool of tools) {
      // Strip null annotation values
      if (tool.annotations) {
        for (const [k, v] of Object.entries(tool.annotations)) {
          if (v === null) delete tool.annotations[k];
        }
        if (Object.keys(tool.annotations).length === 0) delete tool.annotations;
      }
      // Strip empty required arrays
      const schema = tool.inputSchema;
      if (schema && Array.isArray(schema.required) && schema.required.length === 0) {
        delete schema.required;
      }
    }
    return JSON.stringify(parsed);
  } catch {
    return body;
  }
}

async function processStdin() {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      // Process messages sequentially — MCP requires initialize response
      // before notifications/initialized, and session ID must be captured
      // before subsequent requests use it.
      await handleMessage(trimmed);
    }
  }
  process.exit(0);
}

processStdin();

async function handleMessage(line) {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }

  const method = request.method || 'response';
  const id = request.id;
  log(`→ ${method} id=${id ?? 'notification'}`);

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

    // Notifications (no id) should not produce stdout output —
    // the server may return errors for unknown notifications, but
    // forwarding id:null errors breaks Claude Code's JSON-RPC parser.
    const isNotification = id === undefined || id === null;

    if (contentType.includes('text/event-stream')) {
      const text = await resp.text();
      log(`← SSE status=${resp.status} len=${text.length}`);
      if (!isNotification) {
        for (const sseLine of text.split('\n')) {
          if (sseLine.startsWith('data: ')) {
            const data = sseLine.slice(6).trim();
            if (data.length > 0) {
              process.stdout.write(data + '\n');
            }
          }
        }
      }
    } else {
      const body = await resp.text();
      log(`← JSON status=${resp.status} len=${body.length}`);
      if (body.length > 0 && !isNotification) {
        // Clean up tools/list response — Quarkus MCP generates null annotation
        // fields and empty required arrays that can break some MCP clients
        const output = sanitizeResponse(body, method);
        process.stdout.write(output + '\n');
      }
    }
  } catch (err) {
    log(`← ERROR: ${err.message}`);
    // Only send error response for requests (with id), not notifications
    if (id !== undefined) {
      const errorResponse = {
        jsonrpc: '2.0',
        id: id,
        error: {
          code: -32000,
          message: `Vault connection failed: ${err.message}`,
        },
      };
      process.stdout.write(JSON.stringify(errorResponse) + '\n');
    }
  }
}
