#!/bin/sh
# Build and upload the source package to the Launchpad PPA.
# Usage: scripts/ppa.sh <series> <ppa:user/name> [revision]   e.g. scripts/ppa.sh noble ppa:saint-duckworth/ppa
# Set DEBSIGN_KEYID to your GPG key id if its name does not match the changelog.
# Needs: devscripts, debhelper, dput, and a GPG key registered on Launchpad.
set -e
export DEBEMAIL=freakypallet@gmail.com
export DEBFULLNAME=saint
series=${1:?series, e.g. noble}
ppa=${2:?ppa, e.g. ppa:saint-duckworth/ppa}
version=$(node -p "require('./package.json').version")
rev=${3:-1}
npm ci
npm run build
dch --newversion "${version}~${series}${rev}" --distribution "$series" "Release ${version} for ${series}"
debuild -S -sa ${DEBSIGN_KEYID:+-k"$DEBSIGN_KEYID"}
dput "$ppa" "../unreleased-cli_${version}~${series}${rev}_source.changes"
