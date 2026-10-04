import { pickByName } from 'site:termTypes'
import { fail, type Command } from './command'
import { EQ_PRESETS, effects, filterChain, saveEffect } from './effects'
import { playerOf } from './playback'

// `eq`: the site terminal's equalizer command, on mpv's audio filters. Settings
// persist between sessions and apply as soon as the player starts.

const WORDS = ['on', 'off', 'list', 'reset', 'reverb', 'boost', 'balance', 'speed', 'mono', 'pitch', ...EQ_PRESETS.map((p) => p.id)]

function describe(speed: number, pitch: boolean): string {
  const e = effects()
  const preset = EQ_PRESETS.find((p) => p.id === e.preset)?.id ?? e.preset
  return `equalizer ${e.eq ? 'on' : 'off'} · preset ${preset} · boost ${Math.round(e.boost * 100)}% · balance ${Math.round(e.balance * 100)}
reverb ${e.reverb ? 'on' : 'off'} · mix ${Math.round(e.reverbMix * 100)}% · decay ${e.reverbDecay}s · speed ${speed}x · mono ${e.mono ? 'on' : 'off'} · pitch follows speed ${pitch ? 'on' : 'off'}`
}

const onOff = (v: string | undefined, cur: boolean): boolean =>
  v === 'on' ? true : v === 'off' ? false : v === undefined ? !cur : fail('expected on or off')

function numIn(v: string | undefined, lo: number, hi: number, what: string): number {
  const n = Number(v)
  if (v === undefined || v === '' || !Number.isFinite(n) || n < lo || n > hi) fail(`${what} must be ${lo} to ${hi}`)
  return n
}

export const EQ_COMMANDS: Command[] = [
  {
    name: 'eq', group: 'Player',
    usage: 'eq [on | off | list | reset | <preset> | reverb [on|off|<0-100>] [decay 1-8] | boost <100-200> | balance <-100..100> | speed <0.5-2> | mono [on|off] | pitch [on|off]]',
    description: 'Show or change the equalizer, reverb and sound effects; a preset name turns it on with that preset',
    complete: async (arg) => (/\s/.test(arg.trim()) ? [] : WORDS.filter((w) => w.startsWith(arg.trim().toLowerCase()))),
    run: async (args, sh) => {
      const player = playerOf(sh)
      const arg = args.trim().toLowerCase()
      if (!arg) { sh.print(describe(player.speed, player.pitchShift)); return }
      const [sub, ...rest] = arg.split(/\s+/)
      const apply = async (message: string): Promise<void> => { await player.setFilter(filterChain()); sh.print(message, 'ok') }

      if (arg === 'list') { sh.print(EQ_PRESETS.map((p) => `${p.id.padEnd(16)}${p.name}`).join('\n')); return }
      if (sub === 'reverb') {
        const [a, b, c] = rest
        const mix = a === undefined ? undefined : a === 'on' || a === 'off' ? undefined : numIn(a, 0, 100, 'reverb amount') / 100
        // `reverb 40 decay 3` or `reverb 40 3`
        const decayArg = b === 'decay' ? c : b
        const decay = decayArg === undefined ? undefined : numIn(decayArg, 1, 8, 'reverb decay')
        const on = a === undefined ? !effects().reverb : a === 'off' ? false : true
        if (mix !== undefined) saveEffect('reverbMix', mix)
        if (decay !== undefined) saveEffect('reverbDecay', decay)
        saveEffect('reverb', on)
        const e = effects()
        await apply(`reverb ${e.reverb ? 'on' : 'off'} · mix ${Math.round(e.reverbMix * 100)}% · decay ${e.reverbDecay}s`)
        return
      }
      if (sub === 'boost') { saveEffect('boost', numIn(rest[0], 100, 200, 'boost') / 100); await apply(describe(player.speed, player.pitchShift)); return }
      if (sub === 'balance') { saveEffect('balance', numIn(rest[0], -100, 100, 'balance') / 100); await apply(describe(player.speed, player.pitchShift)); return }
      if (sub === 'speed') {
        const v = rest[0] === 'reset' ? 1 : numIn(rest[0]?.replace(/x$/, ''), 0.5, 2, 'speed')
        await player.setSpeed(Math.round(v * 100) / 100)
        sh.print(`speed ${player.speed}x`, 'ok'); return
      }
      if (sub === 'pitch') {
        await player.setPitchShift(onOff(rest[0], player.pitchShift))
        sh.print(`pitch follows speed: ${player.pitchShift ? 'on' : 'off'}`, 'ok'); return
      }
      if (sub === 'mono') { saveEffect('mono', onOff(rest[0], effects().mono)); await apply(`mono ${effects().mono ? 'on' : 'off'}`); return }
      if (arg === 'on' || arg === 'off') { saveEffect('eq', arg === 'on'); await apply(describe(player.speed, player.pitchShift)); return }
      const preset = arg === 'reset'
        ? EQ_PRESETS[0]
        : pickByName(EQ_PRESETS, (p) => p.id, arg) ?? pickByName(EQ_PRESETS, (p) => p.name, arg)
      if (!preset) fail(`no preset "${args.trim()}" (try: eq list)`)
      saveEffect('preset', preset!.id)
      saveEffect('eq', true)
      await apply(describe(player.speed, player.pitchShift))
    },
  },
]
