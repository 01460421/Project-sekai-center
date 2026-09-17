#!/usr/bin/env bash
JP=https://storage.sekai.best/sekai-jp-assets
TC=https://storage.sekai.best/sekai-tc-assets
probe() { printf '%-4s %-24s %8s  %s\n' "$(curl -s -o /dev/null -m 20 -w '%{http_code}' "$1")" "$(curl -s -o /dev/null -m 20 -w '%{content_type}' "$1" | cut -c1-24)" "$(curl -s -o /dev/null -m 20 -w '%{size_download}' "$1")" "$1"; }
for B in $TC $JP; do for p in "scenario/unitstory/piapro-story-chapter/vsleo_01_01.asset" "scenario/special/special-story/op_01.asset" "scenario/actionset/group1/areatalk01_005.asset" "scenario/actionset/group0/areatalk02_129.asset" "comic/one_frame/comic_0001.webp" "character/character_select/chr_tl_26.webp"; do probe "$B/$p"; done; done
echo "-- CORS with another origin"; curl -s -m 20 -D - -o /dev/null -H 'Origin: https://example.com' "$JP/scenario/profile/self_airi.asset" | grep -i 'access-control-allow-origin'
