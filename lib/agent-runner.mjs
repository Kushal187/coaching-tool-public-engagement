// lib/agent-runner.mjs
// Generic agent loop with OpenAI function calling.

import { openaiClient } from './weaviate-client.mjs';

const DEFAULT_MODEL = process.env.CHATBOT_MODEL || 'gpt-4.1';
const DEFAULT_MAX_ITERATIONS = 5;

/**
 * Runs the full agent tool-calling loop and returns the final text response.
 * On the last iteration tool_choice is forced to 'none' to guarantee text output.
 */
export async function runAgentLoop({
  systemPrompt,
  userMessage,
  tools,
  toolImpls,
  model = DEFAULT_MODEL,
  maxIterations = DEFAULT_MAX_ITERATIONS,
  messages: initialMessages,
}) {
  const messages = initialMessages || [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  for (let i = 0; i < maxIterations; i++) {
    const isLast = i === maxIterations - 1;

    const response = await openaiClient.chat.completions.create({
      model,
      messages,
      tools: tools?.length ? tools : undefined,
      tool_choice: tools?.length ? (isLast ? 'none' : 'auto') : undefined,
    });

    const choice = response.choices[0];

    if (choice.finish_reason === 'stop' || !choice.message.tool_calls?.length) {
      return choice.message.content;
    }

    messages.push(choice.message);
    await executeToolCalls(choice.message.tool_calls, toolImpls, messages);
  }

  return null;
}

/**
 * Resolves all tool calls in the agent loop, returning the messages array
 * ready for a final (potentially streaming) call. If the model stops
 * calling tools early, earlyContent will contain the response text.
 */
export async function resolveAgentToolCalls({
  systemPrompt,
  userMessage,
  tools,
  toolImpls,
  model = DEFAULT_MODEL,
  maxIterations = DEFAULT_MAX_ITERATIONS,
  messages: initialMessages,
}) {
  const messages = initialMessages || [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  for (let i = 0; i < maxIterations - 1; i++) {
    const response = await openaiClient.chat.completions.create({
      model,
      messages,
      tools: tools?.length ? tools : undefined,
      tool_choice: 'auto',
    });

    const choice = response.choices[0];

    if (choice.finish_reason === 'stop' || !choice.message.tool_calls?.length) {
      return { messages, earlyContent: choice.message.content };
    }

    messages.push(choice.message);
    await executeToolCalls(choice.message.tool_calls, toolImpls, messages);
  }

  return { messages, earlyContent: null };
}

/**
 * Streams a final response from OpenAI, returning the accumulated SSE body.
 * Used after resolveAgentToolCalls to stream the final answer.
 */
export async function streamFinalResponse({
  messages,
  model = DEFAULT_MODEL,
}) {
  const stream = await openaiClient.chat.completions.create({
    model,
    messages,
    stream: true,
  });

  let body = '';
  for await (const chunk of stream) {
    const content = chunk.choices?.[0]?.delta?.content || '';
    if (content) {
      body += `data: ${JSON.stringify({ content })}\n\n`;
    }
  }
  return body;
}

// ── Internal helpers ─────────────────────────────────────────

async function executeToolCalls(toolCalls, toolImpls, messages) {
  const results = await Promise.all(
    toolCalls.map(async (toolCall) => {
      try {
        const args = JSON.parse(toolCall.function.arguments);
        const fn = toolImpls[toolCall.function.name];
        if (!fn) throw new Error(`Unknown tool: ${toolCall.function.name}`);
        const result = await fn(args);
        return {
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        };
      } catch (err) {
        console.error(`Tool ${toolCall.function.name} failed:`, err.message);
        return {
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: err.message }),
        };
      }
    }),
  );
  messages.push(...results);
}
