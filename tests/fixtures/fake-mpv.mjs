// Minimal stand-in for mpv's JSON IPC server, used by mpv.test.ts.
// Usage: node fake-mpv.mjs --input-ipc-server=<pipe> [...mpv flags] -- <file>
import net from 'node:net'

const pipe = process.argv.find((a) => a.startsWith('--input-ipc-server='))?.split('=')[1]
const fileArg = process.argv[process.argv.indexOf('--') + 1]
const startArg = process.argv.find((a) => a.startsWith('--start='))

const props = {
  path: fileArg,
  'media-title': fileArg?.split(/[\\/]/).pop(),
  'track-list': [{ type: 'video' }, { type: 'sub', codec: 'subrip', selected: true, lang: 'eng' }],
  'time-pos': startArg ? Number(startArg.split('=')[1]) : 0,
  pause: false,
  'sub-text': '',
  'sub-start': null,
  'sub-end': null
}
const observed = new Map()
const log = []

const server = net.createServer((socket) => {
  const send = (obj) => socket.write(JSON.stringify(obj) + '\n')
  const change = (name, value) => {
    props[name] = value
    if (observed.has(name)) send({ event: 'property-change', id: observed.get(name), name, data: value })
  }
  const subtitle = (text, start, end) => {
    props['sub-start'] = start
    props['sub-end'] = end
    change('time-pos', start)
    change('sub-text', text)
  }

  let buf = ''
  socket.setEncoding('utf8')
  socket.on('data', (chunk) => {
    buf += chunk
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i)
      buf = buf.slice(i + 1)
      if (!line.trim()) continue
      const { command, request_id } = JSON.parse(line)
      const [name, ...args] = command
      log.push(command)
      if (name === 'observe_property') {
        observed.set(args[1], args[0])
        send({ request_id, error: 'success' })
        send({ event: 'property-change', id: args[0], name: args[1], data: props[args[1]] ?? null })
        if (args[1] === 'pause') {
          // All properties observed: play a few subtitles. ASS tags and \N line breaks, as mpv sends them.
          setTimeout(() => subtitle('{\\an8}<i>I don\'t think</i>\\Nthat\'s a good idea.', 1.5, 3.2), 30)
          setTimeout(() => subtitle('', null, null), 60)
          setTimeout(() => subtitle('What are you\ntalking about?', 4.0, 6.0), 90)
          // Same subtitle reported again (e.g. after a pause): must not duplicate.
          setTimeout(() => subtitle('What are you\ntalking about?', 4.0, 6.0), 120)
        }
      } else if (name === 'get_property') {
        if (args[0] === 'command-log') send({ request_id, error: 'success', data: log })
        else send({ request_id, error: 'success', data: props[args[0]] ?? null })
      } else if (name === 'set_property') {
        props[args[0]] = args[1]
        send({ request_id, error: 'success' })
      } else if (name === 'quit') {
        send({ request_id, error: 'success' })
        setTimeout(() => process.exit(0), 10)
      } else {
        send({ request_id, error: 'success' })
      }
    }
  })
})

server.listen(pipe)
setTimeout(() => process.exit(0), 15000)
