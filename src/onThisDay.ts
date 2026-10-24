import { DAY_EVENT_LABELS, dayHeadline, dayNote, dayQueue, eventsOnDay, hasAudio, loadDaySongs, yearsSince } from 'site:onThisDay'
import { parseArgs } from 'site:termTypes'
import { fail, type Command } from './command'
import { playerOf } from './playback'
import { trackFromSong } from './player'
import { rememberList } from './songs'

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const DAY_USAGE = 'onthisday [MM-DD | YYYY-MM-DD | jan 25 | yesterday | tomorrow] [play] [--json]'

// The day `onthisday` was given: today by default. Only the month and day
// matter, so any year works and Feb 29 is a day like the rest.
function dayFromArgs(words: string[]): { month: number; day: number } {
  const text = words.join(' ').trim().toLowerCase()
  const now = new Date()
  const shift = text === 'yesterday' ? -1 : text === 'tomorrow' ? 1 : text === '' || text === 'today' ? 0 : null
  if (shift !== null) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + shift)
    return { month: d.getMonth() + 1, day: d.getDate() }
  }
  let m = /^(?:\d{4}-)?(\d{1,2})-(\d{1,2})$/.exec(text) ?? /^(\d{1,2})\/(\d{1,2})$/.exec(text)
  let month = m ? Number(m[1]) : 0
  let day = m ? Number(m[2]) : 0
  if (!m && (m = /^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?$/.exec(text) ?? /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)$/.exec(text))) {
    const [name, num] = /^\d/.test(m[1]) ? [m[2], m[1]] : [m[1], m[2]]
    month = MONTH_NAMES.findIndex((n) => name.startsWith(n)) + 1
    day = Number(num)
  }
  // 2000 was a leap year, so this accepts Feb 29 and rejects Feb 30.
  if (month < 1 || month > 12 || new Date(2000, month - 1, day).getDate() !== day) fail(`usage: ${DAY_USAGE}`)
  return { month, day }
}

export const ON_THIS_DAY_COMMANDS: Command[] = [
  {
    name: 'onthisday', aliases: ['otd'], group: 'Library', usage: DAY_USAGE,
    description: 'What was recorded, previewed, surfaced or released on this day in past years (or on another day), the same list as Home’s On this day card, numbered (then play N / queue add N). play queues the whole day, oldest first',
    complete: async (args) => {
      const before = args.trim().split(/\s+/)
      const partial = args.endsWith(' ') ? '' : before.pop() ?? ''
      return ['today', 'yesterday', 'tomorrow', 'play'].filter((w) => !before.includes(w) && w.startsWith(partial.toLowerCase()))
    },
    run: async (args, ctx) => {
      const { rest, bool } = parseArgs(args)
      const play = rest.some((w) => w.toLowerCase() === 'play')
      const { month, day } = dayFromArgs(rest.filter((w) => w.toLowerCase() !== 'play'))
      const now = new Date()
      const isToday = month === now.getMonth() + 1 && day === now.getDate()
      const label = new Date(2000, month - 1, day).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
      const years = eventsOnDay(await loadDaySongs(month, day), month, day, now)
      if (bool.has('json')) {
        ctx.print(JSON.stringify(years.map((y) => ({
          year: y.year,
          entries: y.entries.map((e) => ({
            kind: e.kind, title: e.title, labels: e.labels,
            songs: e.songs.map((s) => ({ id: s.id, public_id: s.public_id, name: s.name, era: s.era?.name ?? null, category: s.category, has_audio: hasAudio(s) })),
          })),
        })), null, 2))
        return
      }
      if (play) {
        const queue = dayQueue(years)
        if (queue.length === 0) fail(`nothing from ${label} has audio`)
        await playerOf(ctx).playCollection(queue.map(trackFromSong))
        ctx.print(`▶ ${queue.length} song${queue.length === 1 ? '' : 's'} from ${label}, oldest first`, 'ok')
        return
      }
      const note = dayNote(month, day)
      if (years.length === 0) { ctx.print(`${note ? `${note}\n` : ''}nothing in the catalogue is dated to ${label} yet`, 'dim'); return }
      // Numbered like find, so play N / queue add N pick a song from here.
      const picks = years.flatMap((y) => y.entries.map((e) => e.songs[0]))
      rememberList(picks)
      let n = 0
      const lines = [
        `${label}${isToday ? ' (today)' : ''}`,
        ...(note ? [note] : []),
        dayHeadline(years, isToday, now) ?? '',
        ...years.flatMap((y) => [
          '',
          `${y.year} · ${yearsSince(y.year, isToday, now)}`,
          ...y.entries.map((e) => {
            const versions = e.songs.length > 1 ? `  ×${e.songs.length}` : ''
            return `${String(++n).padStart(4)}  ${DAY_EVENT_LABELS[e.kind].padEnd(10)}${e.title}  (${e.songs[0].era?.name ?? e.songs[0].category})${versions}${hasAudio(e.songs[0]) ? '' : '  no audio'}`
          }),
        ]),
        '',
        'play N · queue add N · onthisday play',
      ]
      ctx.print(lines.join('\n'), 'plain')
    },
  },
]
