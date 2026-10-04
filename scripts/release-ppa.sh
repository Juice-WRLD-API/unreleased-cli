#!/bin/sh
# One-shot PPA release, run inside the Ubuntu VM:
#   /media/sf_Unreleased/unreleased-cli/scripts/release-ppa.sh [new-version] [series]
# e.g. release-ppa.sh 0.1.1          bump to 0.1.1 and upload for noble
#      release-ppa.sh                re-upload the current version as revision 2 (packaging fix)
set -e

SRC=/media/sf_Unreleased/unreleased-cli
WORK=$HOME/unreleased-cli
PPA=ppa:saint-duckworth/unreleased-cli
export DEBSIGN_KEYID=8246516ADCA892F1

new=$1
series=${2:-noble}

if [ -n "$new" ]; then
  sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$new\"/" "$SRC/package.json"
  rev=1
else
  rev=2
fi

rsync -a --delete --exclude node_modules --exclude dist --exclude .git "$SRC"/ "$WORK"/
cd "$WORK"
chmod +x debian/rules scripts/*.sh
chmod 644 debian/control debian/changelog debian/copyright

scripts/ppa.sh "$series" "$PPA" "$rev"

# keep the changelog entry in the real repo
cp "$WORK/debian/changelog" "$SRC/debian/changelog"
echo "Uploaded. Watch for the Launchpad email."
