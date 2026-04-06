import fs from 'node:fs/promises'
import path from 'node:path'

export const phase1Tools = [
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: 'List contents of a directory to see available files and folders. Use this to look around the filesystem before deciding what command to propose.',
      parameters: {
        type: 'object',
        properties: {
          dir_path: { 
            type: 'string', 
            description: 'Directory path (relative or absolute). Defaults to current directory.' 
          }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file_preview',
      description: 'Read the first N lines of a file to understand its contents without overwhelming context.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { 
            type: 'string',
            description: 'Path to the file to read'
          },
          lines: { 
            type: 'number', 
            description: 'Number of lines to read (default 50)' 
          }
        },
        required: ['file_path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_disk_space',
      description: 'Get free and total disk space for a given path.',
      parameters: {
        type: 'object',
        properties: {
          dir_path: { 
            type: 'string', 
            description: 'Path to check disk space' 
          }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'propose_shell_command',
      description: 'Propose a shell command to execute in order to fulfill the user\'s intent. Use this when you have gathered enough information and are ready to run a command.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The shell command to execute. Must be a plain string, NO MARKDOWN FENCES (no ```bash or ```), and NO prefix or suffix. Just the literal executable string.'
          },
          explanation: {
            type: 'string',
            description: 'A brief explanation of what this command will do'
          }
        },
        required: ['command', 'explanation']
      }
    }
  }
]

export const toolRunners = {
  list_directory: async (args, cwd) => {
    const target = path.resolve(cwd, args.dir_path || '.')
    try {
      const entries = await fs.readdir(target, { withFileTypes: true })
      if (entries.length === 0) return 'Directory is empty.'
      // Sort directories first, then files
      entries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1
        if (!a.isDirectory() && b.isDirectory()) return 1
        return a.name.localeCompare(b.name)
      })
      return entries.map(e => `${e.isDirectory() ? '[DIR]' : '[FILE]'} ${e.name}`).join('\n')
    } catch (err) {
      return `Error listing directory ${target}: ${err.message}`
    }
  },
  
  read_file_preview: async (args, cwd) => {
    const target = path.resolve(cwd, args.file_path)
    const lines = args.lines || 50
    try {
      const content = await fs.readFile(target, 'utf8')
      const splitted = content.split('\n')
      if (splitted.length <= lines) return content
      return splitted.slice(0, lines).join('\n') + '\n\n... (file truncated)'
    } catch (err) {
      return `Error reading file ${target}: ${err.message}`
    }
  },
  
  get_disk_space: async (args, cwd) => {
    const target = path.resolve(cwd, args.dir_path || '.')
    try {
      const stat = await fs.statfs(target)
      const free = (stat.bavail * stat.bsize) / (1024 ** 3)
      const total = (stat.blocks * stat.bsize) / (1024 ** 3)
      return `Free: ${free.toFixed(2)} GB\nTotal: ${total.toFixed(2)} GB`
    } catch (err) {
      if (err.code === 'ENOSYS' || !fs.statfs) {
        return `Error: fs.statfs not supported on this platform/node version.`
      }
      return `Error checking disk space for ${target}: ${err.message}`
    }
  }
}
