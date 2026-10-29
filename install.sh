#!/usr/bin/env bash
# Installs Ground Control on macOS or Linux in one line (packet I step 6, plan §4.3):
#
#   curl -fsSL https://github.com/vigneshrs-moxie/feature-workshop/releases/latest/download/install.sh | bash
#
# 1. Node 22 or later: when it is missing it prints the line that gets it and asks before running it.
# 2. Downloads the newest release's package file and SHA256SUMS and checks the one against the other.
#    Nothing is installed or run from a download that doesn't match.
# 3. Runs that package's `ground-control doctor --json`, and for each thing missing prints the fix
#    and asks (yes or no) before running it.
# 4. npm i -g <the package file>, then `ground-control install` (the background service from
#    sign-in), then opens http://127.0.0.1:4477/next/.
#
# Runs in bash and zsh. Answers come from the terminal even when the script itself comes through a
# pipe; with no terminal to ask in, every question is answered no.
#
# Settings, for trying the script:
#   GROUND_CONTROL_RELEASE_REPO   the GitHub repository the release comes from
#   GROUND_CONTROL_FROM           a folder that already holds a package file and its SHA256SUMS
#                                 (used instead of downloading; still checked)
#   GROUND_CONTROL_NO_SERVICE=1   install the program only: no service, nothing opened

set -eu

PRODUCT="Ground Control"
PACKAGE="@moxie/ground-control"
COMMAND="ground-control"
REPO="${GROUND_CONTROL_RELEASE_REPO:-vigneshrs-moxie/feature-workshop}"
DASHBOARD_URL="http://127.0.0.1:4477/next/"
FROM="${GROUND_CONTROL_FROM:-}"
NO_SERVICE="${GROUND_CONTROL_NO_SERVICE:-}"
NODE_MAJOR=22

say() { printf '%s\n' "$*"; }
fail() { printf '%s\n' "$*" >&2; exit 1; }
has() { command -v "$1" > /dev/null 2>&1; }

# A terminal to ask in (also when this script is piped into bash).
if ( : < /dev/tty ) 2> /dev/null; then TTY=/dev/tty; else TTY=""; fi

# ask "Question?" → yes (0) or no (1). No terminal: no.
ask() {
  if [ -z "$TTY" ]; then
    say "$1 [y/N] no (there is no terminal to answer in)"
    return 1
  fi
  printf '%s [y/N] ' "$1" > "$TTY"
  answer=""
  read -r answer < "$TTY" || answer=""
  case "$answer" in
    y|Y|yes|Yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

# run_fix "<line>": runs a fix line in sh, with the terminal as its input (gh auth login asks things).
run_fix() {
  if [ -n "$TTY" ]; then sh -c "$1" < "$TTY"; else sh -c "$1" < /dev/null; fi
}

# Everything runs from main, called on the last line: with curl … | bash, bash has then read the
# whole script, so nothing below can read the rest of it as its input.
main() {
  case "$(uname -s)" in
    Darwin) SYSTEM=macOS ;;
    Linux) SYSTEM=Linux ;;
    *) fail "This script is for macOS and Linux. On Windows, use install.ps1 (see docs/install.md)." ;;
  esac

  say "Installing $PRODUCT on $SYSTEM."
  say ""

  # ---------- 1. Node 22 or later ----------

  node_major() {
    if has node; then node -p 'process.versions.node.split(".")[0]' 2> /dev/null || echo 0; else echo 0; fi
  }

  node_line() {
    if [ "$SYSTEM" = macOS ]; then
      if has brew; then echo "brew install node"; fi
      return 0
    fi
    if has apt-get; then echo "sudo apt-get install -y nodejs npm"
    elif has dnf; then echo "sudo dnf install -y nodejs"
    elif has pacman; then echo "sudo pacman -S nodejs npm"
    elif has zypper; then echo "sudo zypper install nodejs22"
    fi
  }

  if [ "$(node_major)" -lt "$NODE_MAJOR" ]; then
    if has node; then say "$PRODUCT needs Node $NODE_MAJOR or later; this computer has Node $(node -v)."; else say "$PRODUCT needs Node $NODE_MAJOR or later, and this computer has no Node."; fi
    line="$(node_line)"
    if [ -n "$line" ] && ask "Run this to get it?  $line"; then
      run_fix "$line" || true
      hash -r 2> /dev/null || true
    fi
    if [ "$(node_major)" -lt "$NODE_MAJOR" ]; then
      fail "Node $NODE_MAJOR or later still isn't here. Get it from https://nodejs.org/en/download${line:+ (or run: $line)}, then run this again. Nothing else was changed."
    fi
  fi
  say "Node $(node -v): OK"

  # ---------- 2. The package file, checked against SHA256SUMS ----------

  WORK="$(mktemp -d "${TMPDIR:-/tmp}/ground-control-install.XXXXXX")"
  trap 'rm -rf "$WORK"' EXIT

  if [ -n "$FROM" ]; then
    say "Using the release files in $FROM."
    cp "$FROM/SHA256SUMS" "$WORK/" 2> /dev/null || fail "$FROM has no SHA256SUMS. Nothing was changed."
    for f in "$FROM"/moxie-ground-control-*.tgz; do [ -f "$f" ] && cp "$f" "$WORK/"; done
  elif has gh && gh auth status > /dev/null 2>&1; then
    say "Downloading the newest release of $PRODUCT from $REPO (with GitHub CLI)."
    gh release download --repo "$REPO" --pattern 'moxie-ground-control-*.tgz' --pattern SHA256SUMS --dir "$WORK" \
      || fail "The download from $REPO didn't finish. Check the network and run this again. Nothing was changed."
  else
    has curl || fail "This script needs curl (or GitHub CLI) to download $PRODUCT. Install one, then run this again."
    say "Downloading the newest release of $PRODUCT from $REPO."
    base="https://github.com/$REPO/releases/latest/download"
    curl -fsSL -o "$WORK/SHA256SUMS" "$base/SHA256SUMS" \
      || fail "SHA256SUMS couldn't be downloaded from $base. Check the network and run this again. Nothing was changed."
  fi

  # The package file's name, from SHA256SUMS ("<sha256>  <name>" lines).
  NAME="$(sed -n 's/^[0-9a-fA-F]\{64\}[ *]*\(moxie-ground-control-[^ /]*\.tgz\)[[:space:]]*$/\1/p' "$WORK/SHA256SUMS" | head -n 1)"
  [ -n "$NAME" ] || fail "SHA256SUMS doesn't name a package file, so nothing can be checked. Nothing was changed."
  if [ ! -f "$WORK/$NAME" ] && [ -z "$FROM" ]; then
    curl -fsSL -o "$WORK/$NAME" "https://github.com/$REPO/releases/latest/download/$NAME" \
      || fail "$NAME couldn't be downloaded. Check the network and run this again. Nothing was changed."
  fi
  [ -f "$WORK/$NAME" ] || fail "$NAME isn't there to check. Nothing was changed."

  WANT="$(awk -v n="$NAME" '{ f = $2; sub(/^\*/, "", f); if (f == n) { print tolower($1); exit } }' "$WORK/SHA256SUMS")"
  GOT="$(node -e 'const c = require("node:crypto"), fs = require("node:fs"); process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$WORK/$NAME")"
  if [ -z "$WANT" ] || [ "$WANT" != "$GOT" ]; then
    fail "The download didn't match its checksum. Nothing was changed."
  fi
  say "$NAME: checksum OK"
  say ""

  # ---------- 3. What else is missing (doctor --json), each fix only after a yes ----------

  mkdir -p "$WORK/package-files"
  tar -xzf "$WORK/$NAME" -C "$WORK/package-files"
  CLI="$WORK/package-files/package/bin/ground-control.js"

  missing_list() {
    # One line per check that isn't OK: runnable<TAB>name<TAB>found<TAB>fix
    node "$CLI" doctor --json 2> /dev/null | node -e '
      let s = ""; process.stdin.on("data", (d) => { s += d; }).on("end", () => {
        let r; try { r = JSON.parse(s); } catch { process.exit(0); }
        for (const c of r.checks) if (!c.ok && c.fix && !["service", "admin"].includes(c.id)) {
          const clean = (t) => String(t).replace(/[\t\r\n]+/g, " ");
          console.log([c.runnable ? "yes" : "no", clean(c.name), clean(c.found), clean(c.fix)].join("\t"));
        }
      });' || true
  }

  say "Checking what else $PRODUCT needs (ground-control doctor)."
  missing_list > "$WORK/missing.txt"
  TAB="$(printf '\t')"
  if [ ! -s "$WORK/missing.txt" ]; then
    say "Everything it needs is here."
  else
    while IFS="$TAB" read -r runnable name found fix; do
      say ""
      say "$name: $found"
      if [ "$runnable" = yes ]; then
        if ask "Run this to fix it?  $fix"; then run_fix "$fix" || say "That didn't finish; you can run it again later: $fix"; fi
      else
        say "  To do by hand: $fix"
      fi
    done < "$WORK/missing.txt"
    hash -r 2> /dev/null || true
  fi
  say ""

  # ---------- 4. Install, set up the service, open it ----------

  say "Installing $PRODUCT ($PACKAGE) with npm."
  if ! npm i -g "$WORK/$NAME"; then
    fail "npm couldn't install $PRODUCT. If it said EACCES, npm's global folder needs other rights: run npm config set prefix \"\$HOME/.npm-global\", add \$HOME/.npm-global/bin to your PATH, and run this again."
  fi
  BIN="$(npm prefix -g)/bin/$COMMAND"
  [ -x "$BIN" ] || BIN="$COMMAND"

  if [ -n "$NO_SERVICE" ]; then
    say ""
    say "$PRODUCT is installed (no service, as asked). Start it with: $COMMAND start --here"
    exit 0
  fi

  say ""
  if "$BIN" install; then
    say ""
    say "Opening $DASHBOARD_URL"
    if [ "$SYSTEM" = macOS ]; then open "$DASHBOARD_URL" || true; elif has xdg-open; then xdg-open "$DASHBOARD_URL" > /dev/null 2>&1 || true; fi
    say "Done. Next: $COMMAND token set saves your Orbit token, and $COMMAND doctor checks everything again."
  else
    say ""
    say "$PRODUCT is installed, but it isn't running as a service (the reason is above)."
    say "It works fully when you start it yourself: $COMMAND start --here, then open $DASHBOARD_URL"
    exit 1
  fi
}

main "$@"
