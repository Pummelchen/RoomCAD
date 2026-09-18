#!/usr/bin/env bash
set -euo pipefail

# Cut a RoomCAD release.
#
#   ./release.sh              # dry run: build, check, report. Changes nothing.
#   ./release.sh --publish    # the same, then tag and publish the GitHub Release.
#
# RELEASE.md is the standard this implements. The rules that shape it:
#
#   §1.2.5  one checksummed artifact, or one checksum file covering all of them —
#           a binary is never published without a digest beside it.
#   §1.2.6  dry run by default; publish only on an explicit flag. That is why
#           --publish exists and why nothing here tags or uploads without it.
#   §1.3    identity is single-sourced. The version is read out of
#           roomcad/web/version.js and nowhere else, and the tag is derived from
#           it rather than typed.
#   §1.4    the tree is clean and HEAD is the tag.
#   §1.6    what the archive carries, and the README-binaries.txt that states the
#           platform floor. This project ships a SOURCE archive (Part 2), so
#           §1.2.1–§1.2.4 do not apply: nothing compiles.
#   §1.7    publish with gh, with --repo pinned. In a fork gh defaults to the
#           PARENT repository, which is how a release lands in the wrong project.
#   §1.8    notes in docs/, ending in a checksum block with the two placeholders,
#           substituted at publish time. The committed notes keep the
#           placeholders; only the Release body carries the real values, so a
#           rebuild can never leave a stale digest in the tree.
#   §1.9    verify the Release afterwards, which this does at the end.
#
# Usage: ./release.sh [--publish]

REPO="Pummelchen/RoomCAD"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

PUBLISH=0
for arg in "$@"; do
  case "$arg" in
    --publish) PUBLISH=1 ;;
    -h|--help) sed -n '3,10p' "$0"; exit 0 ;;
    *) echo "release: unknown argument '$arg' (only --publish)" >&2; exit 2 ;;
  esac
done

die() { echo "release: $*" >&2; exit 1; }
step() { printf '\n== %s ==\n' "$1"; }

# ── §1.3 Identity, from its single source ────────────────────────────────────
VERSION_FILE="roomcad/web/version.js"
VERSION="$(sed -n 's/.*export const APP_VERSION = "\([0-9][0-9]*\.[0-9][0-9]*\)";.*/\1/p' "$VERSION_FILE")"
[ -n "$VERSION" ] || die "no APP_VERSION in $VERSION_FILE — refusing to guess a version"
TAG="v$VERSION"
ARCHIVE_NAME="roomcad-$VERSION-src.tar.gz"
NOTES="docs/release-notes-$TAG.md"
DIST="dist"
step "release $TAG (from $VERSION_FILE, the only version source)"

# ── §1.4 Preconditions ───────────────────────────────────────────────────────
step "preconditions"
[ -z "$(git status --porcelain)" ] || die "the tree is not clean — commit or stash first"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" = "main" ] || die "releases are cut from main, not $BRANCH"
HEAD_SHA="$(git rev-parse --short HEAD)"
echo "  tree clean, on main, HEAD $HEAD_SHA"

command -v gh >/dev/null 2>&1 || die "gh is not installed (§1.7 publishes with gh)"
OWNER="$(gh repo view "$REPO" --json owner -q .owner.login 2>/dev/null)" \
  || die "cannot read $REPO — check gh auth"
ACTOR="$(gh api user -q .login 2>/dev/null)" || die "cannot read the authenticated account"
[ "$ACTOR" = "$OWNER" ] || die "gh is authenticated as '$ACTOR', but $REPO is owned by '$OWNER'"
echo "  gh is authenticated as $ACTOR, the owner of $REPO (§1.4)"

if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  die "tag $TAG already exists — bump the version in $VERSION_FILE instead of reusing it"
fi

# ── §1.8 The notes must exist and must be submissible ────────────────────────
step "release notes"
[ -f "$NOTES" ] || die "$NOTES is missing (RELEASE.md §1.8)"
grep -q 'SHA256_PENDING' "$NOTES" || die "$NOTES has no SHA256_PENDING placeholder (§1.8)"
grep -q 'ARCHIVE_BYTES_PENDING' "$NOTES" || die "$NOTES has no ARCHIVE_BYTES_PENDING placeholder (§1.8)"
echo "  $NOTES carries both placeholders"

# ── §1.6 Package ─────────────────────────────────────────────────────────────
# Built from the COMMITTED tree, so the archive cannot contain anything that is
# not in the tag. Untracked files, including dist/, cannot leak in.
step "package"
rm -rf "$DIST"
mkdir -p "$DIST"
git archive --format=tar.gz --prefix="roomcad-$VERSION/" -o "$DIST/$ARCHIVE_NAME" HEAD

# A gate that cannot fail is not a gate: check the archive for the things §1.6
# requires by name, from the archive itself rather than from the working tree.
for required in LICENSE THIRD_PARTY_NOTICES.md README-binaries.txt README.md; do
  tar -tzf "$DIST/$ARCHIVE_NAME" | grep -qx "roomcad-$VERSION/$required" \
    || die "$ARCHIVE_NAME does not contain $required (§1.6)"
done
echo "  $ARCHIVE_NAME contains LICENSE, THIRD_PARTY_NOTICES.md, README-binaries.txt (§1.6)"

# §1.2.5: a digest beside the artifact, in the format shasum -c reads.
if command -v shasum >/dev/null 2>&1; then
  ( cd "$DIST" && shasum -a 256 "$ARCHIVE_NAME" > "$ARCHIVE_NAME.sha256" )
else
  ( cd "$DIST" && sha256sum "$ARCHIVE_NAME" > "$ARCHIVE_NAME.sha256" )
fi
DIGEST="$(awk '{print $1}' "$DIST/$ARCHIVE_NAME.sha256")"
BYTES="$(wc -c < "$DIST/$ARCHIVE_NAME" | tr -d ' ')"
[ -n "$DIGEST" ] || die "could not compute a digest"
echo "  sha256 $DIGEST"
echo "  $BYTES bytes"

# §1.8: never copy a size out of a dry run — publish rebuilds, and the archive
# differs. So the dry run reports, and --publish rebuilds and substitutes.
step "artifact (${DIST}/)"
ls -l "$DIST"

if [ "$PUBLISH" -eq 0 ]; then
  cat <<EOF

DRY RUN — nothing was tagged and nothing was published.
  tag that would be created : $TAG at $HEAD_SHA
  archive                   : $DIST/$ARCHIVE_NAME ($BYTES bytes)
  digest                    : $DIGEST
  release                   : https://github.com/$REPO/releases/tag/$TAG

Re-run with --publish to create the tag and publish the Release (§1.2.6).
EOF
  exit 0
fi

# ── §1.8 Render the notes for the Release body ───────────────────────────────
# The committed notes keep the placeholders; only this rendered copy carries the
# real values, and §1.8's rule is enforced by reading them back out of it.
step "publish"
RENDERED="$DIST/release-notes-$TAG.published.md"
sed -e "s/SHA256_PENDING/$DIGEST/" -e "s/ARCHIVE_BYTES_PENDING/$BYTES/" \
  "$NOTES" > "$RENDERED"
grep -q "$DIGEST" "$RENDERED" || die "the rendered notes do not quote the digest (§1.8)"
grep -q "$BYTES" "$RENDERED" || die "the rendered notes do not quote the size (§1.8)"
echo "  rendered notes quote the real digest and size (§1.8)"

# ── §1.4 HEAD is the tag ─────────────────────────────────────────────────────
git tag -a "$TAG" -m "RoomCAD $VERSION"
git push origin "$TAG"
echo "  tagged $TAG at $HEAD_SHA and pushed it"

# ── §1.7 Publish, with --repo pinned ─────────────────────────────────────────
gh release create "$TAG" "$DIST/$ARCHIVE_NAME" "$DIST/$ARCHIVE_NAME.sha256" \
  --repo "$REPO" --title "RoomCAD $VERSION" \
  --notes-file "$RENDERED" --verify-tag --latest
echo "  published https://github.com/$REPO/releases/tag/$TAG"

# ── §1.9 Verify the published Release ────────────────────────────────────────
step "verify (§1.9)"
gh release view "$TAG" --repo "$REPO" --json tagName,isLatest,assets \
  -q '"  tag \(.tagName)  latest=\(.isLatest)  assets: \([.assets[].name] | join(", "))"'
DOWNLOADED="$(mktemp -d)"
gh release download "$TAG" --repo "$REPO" --dir "$DOWNLOADED" --pattern "$ARCHIVE_NAME" >/dev/null
if command -v shasum >/dev/null 2>&1; then
  ACTUAL="$(shasum -a 256 "$DOWNLOADED/$ARCHIVE_NAME" | awk '{print $1}')"
else
  ACTUAL="$(sha256sum "$DOWNLOADED/$ARCHIVE_NAME" | awk '{print $1}')"
fi
rm -rf "$DOWNLOADED"
[ "$ACTUAL" = "$DIGEST" ] \
  || die "the published archive's digest is $ACTUAL, not $DIGEST — do not announce this release"
echo "  the published archive re-downloads to the published digest"
echo
echo "released $TAG — $BYTES bytes — sha256 $DIGEST"
