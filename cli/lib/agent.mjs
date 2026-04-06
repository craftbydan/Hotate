import { llmConfig } from './generate.mjs'
import { phase1Tools, toolRunners } from './agent-tools.mjs'

const MAX_TURNS = 7

export async function runAgentLoop({ intent, cwd, context, osKind }) {
  const { host, model, numPredict } = llmConfig()
  
  let systemMsg = `You are Hotate, a helpful CLI assistant running on ${osKind === 'macos' ? 'macOS' : osKind === 'linux' ? 'Linux' : 'a POSIX system'}.
Your goal is to fulfill the user's intent safely.
IMPORTANT TOOL USAGE RULES:
1. If the user asks for read-only information (like "what is in this folder", "read this file", or "how much disk space is left"), you MUST use your native tools (list_directory, read_file_preview, get_disk_space) to gather the data, and then provide a direct text response summarizing the answer. DO NOT propose a shell command for these tasks!
2. If the user's request requires executing a shell command to CHANGE the system (e.g. creating, deleting, moving files, installing things), you MUST use the \`propose_shell_command\` tool once you are ready. NEVER give the user a shell command in plain text to run themselves.
3. If the user is just asking a question or greeting, provide a direct text response.`

  if (context?.trim()) {
    systemMsg += `\n\nExtra Context:\n${context.trim()}`
  }

  const messages = [
    { role: 'system', content: systemMsg },
    { role: 'user', content: `Current directory: ${cwd}\nIntent: ${intent}` }
  ]

  let turn = 0
  while (turn < MAX_TURNS) {
    turn++
    
    let res
    try {
      res = await fetch(`${host}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages,
          tools: phase1Tools,
          stream: false,
          options: {
            temperature: 0.1,
            num_predict: numPredict
          }
        })
      })
    } catch (err) {
      const e = new Error(`Cannot reach Ollama at ${host} (${err.cause?.code || err.message}). Start Ollama and run: ollama pull ${model}`)
      e.code = 'LLM_CONNECTION'
      throw e
    }

    if (!res.ok) {
      const text = await res.text()
      const e = new Error(`Ollama ${res.status} at ${host}/api/chat: ${text.slice(0, 500)}. If the model is missing: ollama pull ${model}`)
      e.code = 'LLM_API'
      throw e
    }

    const data = await res.json()
    const message = data.message

    // Ollama requires assistant messages with tool calls to be appended to the history
    messages.push(message)

    if (message.tool_calls && message.tool_calls.length > 0) {
      let proposedCommand = null
      let proposedNote = null

      for (const call of message.tool_calls) {
        const toolName = call.function.name
        const args = call.function.arguments

        if (toolName === 'propose_shell_command') {
          proposedCommand = args.command
          proposedNote = args.explanation
          // If we got a proposal, we can break out entirely
          break
        }

        let resultText = ''
        if (toolRunners[toolName]) {
          try {
            resultText = await toolRunners[toolName](args, cwd)
          } catch (e) {
            resultText = `Error: ${e.message}`
          }
        } else {
          resultText = `Error: Unknown tool ${toolName}`
        }

        messages.push({
          role: 'tool',
          content: String(resultText)
        })
      }

      // If we broke out with a proposed command, return it
      if (proposedCommand) {
        return {
          kind: 'EXECUTE_SHELL',
          command: proposedCommand,
          note: proposedNote || ''
        }
      }

      // Otherwise, the loop continues to let the LLM evaluate the tool results
    } else {
      // The LLM has provided a text response (no tools)
      return {
        kind: 'CHAT',
        message: message.content || 'I have completed your request.',
        note: ''
      }
    }
  }

  // If we hit MAX_TURNS, just return an error chat
  return {
    kind: 'CHAT',
    message: "I reached the maximum number of thought turns without producing a final shell command or response. Please try rephrasing your intent.",
    note: 'Hit MAX_TURNS limit.'
  }
}
