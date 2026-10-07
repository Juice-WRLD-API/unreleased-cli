# unreleased-cli

The site's terminal as a command-line shell. You can browse the Files tab's channels as a folder tree, read text files, search, and download straight to disk. It uses the same API as the site.

```
guest@unreleased:~/files/comp$ ls
     <dir>  Compilation/
     <dir>  Snippets/
     ...
guest@unreleased:~/files/comp$ get -o covers "Compilation/4. Cover Art"
saved 44 files (25.9 MB) to covers
```

## Install

From npm (any OS, Node 20 or newer):

```
npm install -g unreleased-cli
```

On Ubuntu (PPA; needs Node 20 or newer, which Ubuntu 26.04 has and 24.04 needs from NodeSource):

```
sudo add-apt-repository ppa:saint-duckworth/ppa
sudo apt install unreleased-cli
```

To update later, run `unreleased update` (or `update` inside the shell). It checks for a newer version and installs it if you installed from npm; `update -c` only checks. The shell also tells you at startup when a newer version is out (it asks npm at most once a day, in the background; set `UNRELEASED_NO_UPDATE_CHECK=1` to turn that off).

From source:

```
npm install
npm run build
npm link          # puts `unreleased` on your PATH
```

You can also run it without linking: `node dist/unreleased.mjs`. It needs Node 20 or newer and has no runtime dependencies. Playback also needs [mpv](https://mpv.io) (`winget install shinchiro.mpv`, `brew install mpv`, or your package manager).

## Use

| | |
|---|---|
| `unreleased` | Open the interactive shell. |
| `unreleased ls Snippets` | Run one command and exit. The exit code is 1 if the command failed. A single quoted argument is a whole line: `unreleased "ls \| head 2"`. |
| `unreleased < script.txt` | Run each line of a file. Lines starting with `#` are comments. |

The shell starts in the main channel (`comp`). `cd /` lists every channel, and `cd` on its own takes you back.

Commands (type `help <command>` in the shell for the details of each one):

- **Files:** `cd`, `ls`, `pwd`, `lcd`, `get`, `cat`, `head`, `tail`, `wc`, `grep`, `locate`, `tree`, `du`
- **Library:** `find`, `lyricfind`, `song`, `like`, `unlike`, `liked`, `playlists`, `playlist`, `stats`
- **Player:** `play`, `pause`, `toggle`, `next`, `prev`, `seek`, `volume`, `speed`, `eq`, `shuffle`, `repeat`, `queue`, `status`, `sleep`, `stop`
- **People:** `user`, `lookup`
- **Editor:** `versions`, `proposal`, `comp`, `apply`, `leaderboard`, `changes`
- **Content:** `news`, `unfurl`, `tierlist`, `devfeedback`, `report`, `broadcasts`, `daily`, `fm`
- **Admin** (administrators only): `pending`, `proposals`, `comps`, `applications`, `cdn`, `inspect`, `approve`, `reject`, `reverse`, `users`, `sitebans`, `siteunban`, `era`, `album`, `channels`, `usermod`, `propagation`
- **Fun:** `neofetch`, `fortune`, `juicesay`, `matrix`, `visualizer`, `karaoke`, `wordle`, `heardle`
- **Settings:** `set`, `settings`, `bind`, `termtheme`
- **App:** `http`
- **Shell:** `source`, `alias`, `unalias`, `history`, `error`, `echo`, `watch`, `full`, `date`, `clear`, `reload`, `exit`, `help`
- **Account:** `login`, `logout`, `whoami`, `token`, `api`, `version`, `profile`, `nowplaying`, `donor`, `nodes`, `sync`, `register`, `approvals`, `otp`

Most of the Content, Editor, Admin and Account commands are the site terminal's own code, run unchanged (see `site-modules.mjs`). The chat commands (`dm`, `say`, `keys`, `server`, `room`…) are not in the CLI, which has no chat.

Things that work the same as on the site:

- Pipe output into `grep`, `head`, `tail`, `wc`, `sort`, `uniq` or `juicesay`. A `|` inside quotes stays part of the argument.
- `!!`, `!N` and `!text` re-run earlier commands.
- Ctrl+R searches your history, as in bash:
  - Type to find the newest match, and press Ctrl+R again for older ones.
  - Enter runs the match. Esc or an arrow key puts it on the line to edit.
  - Ctrl+C gives up and leaves the line as it was.
- `cd -` goes back to the previous folder.
- `alias` saves shortcuts.
- Tab completes command names and paths.
- Ctrl+C cancels the running command.
- `watch [-n seconds] <command>` re-runs a command on a refreshing screen, every 2 seconds unless `-n` says otherwise. Quote it if it has a pipe: `watch -n 5 "pending | head 3"`. `q` leaves.

`get` saves into the current local folder. Use `lcd` to change that folder, or `get -o <dir>` for a single download. A folder keeps its structure on disk where the site would hand you a ZIP. Files that already exist are skipped unless you pass `-f`.

## Library

`find <title>` searches the songs and numbers the results. `liked` and `playlist show` number theirs too. A number then stands for that row in the next command: `song 2`, `like 2`, `playlist add Chill -- 2`.

- `song <title | N>` shows a song's era, credits and dates, plus the `get` command that downloads its file.
- `playlist` can show, create, delete, add and remove. A playlist can be named by a few letters of its title or by its number in `playlists`. Deleting asks first, or takes `-y`. Playing a playlist is left to the site, since the CLI has no player.
- `stats [all | 7 | 30] [N]` charts your listening history the way the site does. It needs the whole song catalog (about 11 MB), so a slim copy is kept in `~/.unreleased/cache` for a day. `-r` reloads it.
- `user <id>` works for anyone. `user <name>` needs an administrator account, because it searches the admin account list. The site finds people through chat, which the CLI doesn't have.
- `lookup <text>` searches songs, your playlists, channels, commands and (for administrators) people at once.

Playlists, likes and stats need you to be signed in.

## Playback

Music plays through a hidden mpv that the interactive shell starts the first time you play something.

- `play <title | N>` plays a song by title, or by its number from the last list.
- `play <file | folder>` plays something from the file tree. A folder queues the audio files directly inside it, and `play .` plays the folder you're in.
- `playlist play <name>`, `playlist shuffle <name>`, `liked play` and `shuffle <era> [count]` replace the queue.
- `queue add` and `queue next` add to it. `queue` lists it, and `remove N` / `jump N` change it.
- Shuffle, repeat, previous and the end of the queue behave as they do on the site.
- `status` (or `now`) shows the song, a progress bar, the settings and the queue, and follows along live on a terminal (`q` leaves). `status -1` prints it once, and it does too when piped or run in a script.
- `like` and `unlike` with no song act on the one playing.

The music stops when you leave the shell, so `unreleased play …` on its own says to open the shell instead. If the shell is killed without a chance to stop mpv (for example the terminal window is closed), mpv quits by itself within about 10 seconds.

The CLI looks for mpv on PATH and then in the usual install folders. Set `UNRELEASED_MPV` to its path if it lives somewhere else. mpv reads your own `mpv.conf`, so settings like the audio device carry over.

When you're signed in, a song counts as played once you've listened to it: 30 seconds in, or halfway through anything shorter, the same rule as the site's player. The play is added to your listening history on the site (`POST /accounts/account/me/listening-plays/`), so it shows up in `stats`, Home and your profile. Skipping through a queue doesn't count, and a song you restart or seek back to the start of can count again. Files played from the tree have no song id and never count. If the server refuses a play, the shell says so once.

The song's play counter in your profile goes up by one as well. The server has no increment for it (the counters are one JSON blob the client replaces whole), so the CLI reads the blob, adds the plays and writes it back, keeping every other field as it was. That write waits a few seconds so a run of plays becomes one write, and the shell sends any that are left when you exit. If the shell is killed instead (the terminal window is closed), the last few seconds of counts are lost, but the history entries are not. The site merges counters with max(), so a count raised here isn't undone by a stale copy there.

## Admin

These cover the Admin page's review queues and site moderation, using the same endpoints. They only appear in `help` for an administrator account, and they stop any other account before a request is sent. If your role changed since you logged in, run `whoami` to refresh it.

- `pending` shows how much is waiting in each queue.
- `proposals`, `comps` and `applications` list a queue. Each takes a status: pending (the default), approved, rejected, or reversed.
- `inspect [song|comp|app] <id>` shows one item in full. For a song edit, that's every field it changes.
- `approve` and `reject` take `[song|comp|app] <id> [note]`. Song edits are the default kind, so `approve 12` and `reject 12 no source` work as they are.
- `reverse [song|comp] <id>` undoes an approved proposal.
- `users [role] [filter]` lists accounts. `user <name>` shows one person.
- `sitebans` lists active site-wide bans, mutes and timeouts. `siteunban <user | #id>` lifts them.
- `cdn` shows the CDN stats and every node, pending ones first. `cdn <node>` shows one in full, where a node is its id, the start of the id, or its name. `cdn approve|revoke|enable|disable|reset|restore|delete <node>` does what the Admin page's CDN nodes tab does. `restore` is for a node the server pulled for hash violations: it switches it back on and resets its trust and violations. `delete` asks first unless you pass `-y`.

`reverse` and `siteunban` ask before they act. Outside the interactive shell, such as in one-shot use or a script, they need `-y` instead.

## Fun

- `neofetch` shows system info with a logo.
- `fortune` prints a random lyric line from a random song. Try `fortune | juicesay`.
- `juicesay [text]` has a juice box say it.
- `matrix` is digital rain. Any key leaves.
- `visualizer` (or `viz`) is a live spectrum of the song that's playing. Any key leaves. mpv can't hand its audio over, so a second mpv decodes the same stream to a temp file and the bars come from that, which means the song is downloaded a second time while the screen is open.
- `karaoke` (or `lyrics`) shows the lyrics of the song that's playing. Synced lyrics highlight the line being sung and scroll along; plain ones scroll with the arrow keys and Page Up/Down. Space pauses, `q` leaves. It needs a song from the library (not a file played from the tree).
- `eq` shows the equalizer settings. `eq list` names the presets (the site's own), `eq rock` turns the equalizer on with one, and `eq off` / `eq reset` switch it off or flatten it. `eq boost 100-200`, `eq balance -100..100`, `eq speed 0.5-2` and `eq pitch [on|off]` (the same as the `speed` command and the `pitch-shift` setting), `eq mono [on|off]` and `eq reverb [on|off|0-100] [decay 1-8]` do the rest. It runs through mpv's audio filters, so the reverb is an echo approximation of the site's. Settings carry over between sessions, and changes apply to the song that's playing.
- `wordle [daily | unlimited]` is the song-title Wordle, using the site's own puzzle logic, so the daily puzzle is the same one. Type a title and press Enter. Esc leaves, and your progress is saved.
- `heardle` gives practice rounds: Tab plays the clip, Enter guesses (an empty Enter skips), and ↑↓ picks a suggestion. The clip plays through its own mpv. Music that was playing gets paused, and `play` resumes it.

`matrix`, `visualizer`, `karaoke`, `wordle`, `heardle` and `watch` take over the whole terminal, then hand it back as it was. They need an interactive terminal, so they won't run from a pipe or a script.

Wordle and Heardle keep their progress, streaks and song lists in `~/.unreleased/storage.json`. That's separate from your browser's, the same way two browsers are separate. They use the default game settings, because the settings you change on the site are stored in your browser.

## Settings

`settings` lists what you can change, and `set <setting> [value]` shows or changes one (`set volume 40`, `set shuffle toggle`; Tab completes the names and choices). They're kept in `~/.unreleased/settings.json`, so they carry over to the next session, and without the shell (`unreleased set volume 40`) the value is saved for next time. The site's Settings screen is mostly look and layout, so only the parts a command line has are here:

| Setting | |
|---|---|
| `theme` | The terminal colour scheme, the same as `termtheme` |
| `color` | Colour in the output (`NO_COLOR` turns it off too) |
| `volume`, `speed`, `repeat`, `shuffle` | The player's modes. The `volume`, `speed`, `repeat` and `shuffle` commands change the same values, and they now stay put between sessions, as on the site |
| `pitch-shift` | Let the pitch follow the speed (off keeps the pitch where it was) |

`termtheme [name]` lists the colour schemes (the site's own list, so a new one there turns up here after the next sync and build) or switches to one. A scheme colours the prompt, messages, rain and visualizer in truecolor, and the default one uses your terminal's own palette. It can't change the terminal's background.

`full` asks the terminal window to go fullscreen, and to leave again. It sends the xterm request for that, which many terminals ignore (Windows Terminal does), so F11 is the fallback.

`reload` (or `restart`) closes the shell and starts a fresh one, so a version installed by `update` is the one that runs, and your settings and rc file are read again. It only works in the interactive shell, and music stops.

## Shortcuts

The player has keyboard shortcuts at the prompt, so you can seek or change the volume without typing a command. They use the site's action names and key format (Settings > Shortcuts there), and a message above the prompt says what they did.

| Keys | Does |
|---|---|
| Shift+← / Shift+→ | Skip back / forward (10 seconds, or `set hotkey-seek`) |
| Ctrl+← / Ctrl+→ | Previous / next track |
| Ctrl+↑ / Ctrl+↓ | Volume up / down |
| Alt+P | Play / pause |
| Alt+M | Mute |
| Alt+S, Alt+R | Shuffle, cycle repeat |
| Alt+L | Like the song |
| Alt+. / Alt+, | Speed up / down |

`bind` lists them. `bind seek-forward alt+right` changes one, `bind mute none` clears one, `bind reset` puts them all back, and `bind alt+p` says what a key does. Giving a key that's already used to another action moves it. Any action can take a key, including `seek-0` to `seek-90`, which jump to that percentage and have none by default.

Keys the line editor needs for typing can't be bound: Ctrl+letters, Alt+B, Alt+F and Alt+D. A bare key only works on an empty line, so the arrow keys, Home and the F-keys can be shortcuts without getting in the way. Your terminal may keep some combos for itself (Windows Terminal uses Alt+arrows, for one).

## Signing in

You can browse the files without an account. To sign in:

- `login` asks for your API token. On the site, open the terminal and type `token copy` to get it.
- `login <username>` signs in with a username and password, and asks for a 2FA code if the account has one.

`logout` only forgets the token on this computer. The token itself keeps working on the site.

## API base and route rules

`api` shows the current base. `api set <url>` moves everything to another API instance, and `api reset` goes back to the default.

Route rules send one path prefix somewhere else on top of that, like the site's Settings: `api rule /cdn https://cdn.example.com/juicewrld`. The longest matching prefix wins. `api unrule /cdn` removes one. `UNRELEASED_API` still overrides the base.

## Files and environment

Everything is kept in `~/.unreleased`. Set `UNRELEASED_HOME` to use another folder.

| File | Contents |
|---|---|
| `config.json` | The token and account name (owner-only permissions where the OS supports it), plus an optional `"api"` base URL and `"rules"` route rules (set both with the `api` command) |
| `history` | Typed commands. Start a line with a space and it won't be saved. |
| `aliases.json` | Your aliases |
| `settings.json` | What `set` and `termtheme` change: theme, colour, volume, speed, repeat, shuffle, pitch-shift |
| `storage.json` | Wordle and Heardle progress, streaks and their cached song lists |
| `cache/catalog.json` | The song catalog `stats` and `shuffle <era>` use, refreshed daily |
| `rc` | Commands run each time the interactive shell starts |

| Environment variable | Effect |
|---|---|
| `UNRELEASED_TOKEN` | Use this token instead of the saved one |
| `UNRELEASED_API` | Use another API base (the default is `https://juicewrldapi.com/juicewrld`) |
| `UNRELEASED_MPV` | The mpv executable to play through |
| `NO_COLOR` | Turn off colours |

Git Bash on Windows rewrites a bare `/` argument into its own install path, so `unreleased ls /` lists the wrong place there. Run it from inside the shell, or set `MSYS_NO_PATHCONV=1`.

## How it's built

Some of the CLI is the site's own code, compiled in by `build.mjs`. That code lives in `site/`, a copy of the files from the site repo (kept in the same folder layout, so their imports still resolve). `site/SYNCED_FROM.json` says which site commit it was taken from, and `site-modules.mjs` lists which modules are used and which of their imports are swapped for a Node version:

- `cat`, `head`, `tail`, `wc`, `grep`, `locate`, `tree` and `du` come from `src/renderer/src/lib/terminalFileTools.ts`. Its imports point at `src/files.ts`, the Node version of the site's `terminalFiles.ts`.
- The `stats` maths comes from `lib/listeningStats.ts`. Its two helpers from `juicewrldApi.ts` are swapped for `src/shims/juicewrldApi.ts`.
- Playlist name matching comes from `lib/terminal/types.ts`.
- The `termtheme` colour schemes come from `lib/terminal/themeStore.ts` (its `react` import is swapped for a stub).
- The Wordle and Heardle logic comes from `lib/wordle.ts`, `lib/heardle.ts` and `lib/versionsApi.ts`. That covers the daily pick, grading, title search and version matching. Their request helpers are swapped for shims in `src/shims/`, and `localStorage` for `src/shims/localStorage.ts`.

A change to those on the site reaches the CLI when you run `npm run sync` (it copies the files from the site checkout next to this repo, `../music-player-web`; pass another path with `npm run sync -- <path>` or `UNRELEASED_SITE`) and then `npm run build`. The sync works out the file list itself by bundling against the checkout, so a new import in one of those modules is picked up without editing anything. The declarations in `src/site.d.ts` have to stay in step with their signatures. The other commands are ports, because their site versions read the app's stores.
