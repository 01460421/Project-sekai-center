#!/usr/bin/env bash
JP=https://storage.sekai.best/sekai-jp-assets
TC=https://storage.sekai.best/sekai-tc-assets
probe() { printf '%-4s %-24s %8s  %s\n' "$(curl -s -o /dev/null -m 20 -w '%{http_code}' "$1")" "$(curl -s -o /dev/null -m 20 -w '%{content_type}' "$1" | cut -c1-24)" "$(curl -s -o /dev/null -m 20 -w '%{size_download}' "$1")" "$1"; }
echo "== bucket listing (S3 style) =="
for u in "$JP/?list-type=2&prefix=event_story/event_colorcross_2025/&max-keys=40" "$JP/?prefix=event_story/event_colorcross_2025/&max-keys=40" "$TC/?list-type=2&prefix=event_story/event_colorcross_2025/&max-keys=40" "$JP/?list-type=2&prefix=scenario/&delimiter=/&max-keys=40" "$JP/?list-type=2&prefix=character/member/res001_no001/&max-keys=40"; do echo "--- $u"; curl -s -m 20 "$u" | head -c 1500; echo; done
echo "== event story variants =="
for ev in event_persona_2023:event_100_01 event_peaky_2022:event_50_01 event_stella_2020:event_01_01; do abn=${ev%%:*}; sid=${ev##*:}; for B in $TC $JP; do for p in "event_story/$abn/scenario_rip/$sid.asset" "event_story/$abn/scenario_rip/$sid.json" "event_story/$abn/scenario/$sid.asset" "event_story/$abn/scenario/$sid.json" "event_story/${abn}_rip/scenario/$sid.asset" "event_story/$abn/scenario/$sid" "event/$abn/scenario/$sid.json"; do probe "$B/$p"; done; done; done
echo "== unit / card / talk / self / special variants =="
for B in $TC $JP; do for p in "scenario/unitstory/piapro/vsleo_01_01.asset" "scenario/unitstory_rip/piapro/vsleo_01_01.asset" "scenario/unitstory/piapro_rip/vsleo_01_01.json" "scenario/unitstory/piapro/vsleo_01_01" "character/member/res001_no001/001001_ichika01.asset" "character/member_scenario/res001_no001/001001_ichika01.json" "character/member_scenario/res001_no001_rip/001001_ichika01.asset" "character/member/res001_no001/001001_ichika01" "scenario/actionset/group0/as_cdshop_mob.asset" "scenario/actionset_rip/group0/as_cdshop_mob.asset" "scenario/actionset/group0/as_cdshop_mob" "scenario/profile/self_ichika_2nd.asset" "scenario/profile_rip/self_ichika_2nd.json" "scenario/profile/self_ichika_2nd" "scenario/special/story_sp_ts_01_01/op_01.asset" "scenario/special_rip/story_sp_ts_01_01/op_01.asset" "scenario/special/story_sp_ts_01_01/op_01"; do probe "$B/$p"; done; done
echo "== background guesses =="
for p in "scenario/background/bg_c001101/bg_c001101.webp" "scenario/background/bg_a000001/bg_a000001.webp" "scenario/background/bg_c001101_rip/bg_c001101.webp" "scenario/background_rip/bg_c001101/bg_c001101.webp"; do probe "$JP/$p"; done
echo "== thumbnail/chara =="
for p in "thumbnail/chara/res001_no001_normal.webp" "thumbnail/chara_rip/res001_no001_normal.webp" "character/member_cutout/res001_no001/normal.png" "character/member_cutout_trm/res001_no001/normal.webp"; do probe "$JP/$p"; done
