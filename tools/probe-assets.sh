#!/usr/bin/env bash
# 一次性探測：storage.sekai.best 上各種素材路徑實際回什麼（在 GitHub Runner 跑，沙盒連不到）
JP=https://storage.sekai.best/sekai-jp-assets
TC=https://storage.sekai.best/sekai-tc-assets
MDB=https://raw.githubusercontent.com/Sekai-World/sekai-master-db-tc-diff/main
probe() { printf '%-4s %-28s %8s  %s\n' "$(curl -s -o /dev/null -m 20 -w '%{http_code}' "$1")" "$(curl -s -o /dev/null -m 20 -w '%{content_type}' "$1" | cut -c1-28)" "$(curl -s -o /dev/null -m 20 -w '%{size_download}' "$1")" "$1"; }
echo "== character =="
for u in "$JP/character/character_select/chr_tl_1.webp" "$JP/character/character_select_rip/chr_tl_1.webp" "$JP/character/trim_rip/chr_trim_1.webp" "$JP/character/trim/chr_trim_1.webp" "$JP/character/label_rip/chr_h_lb_1.webp" "$JP/character/label/chr_h_lb_1.webp" "$JP/character/character_sd_l/chr_sp_1.webp" "$JP/character/character_sd_l_rip/chr_sp_1.webp"; do probe "$u"; done
echo "== event story json =="
for u in "$TC/event_story/event_colorcross_2025/scenario/event_183_01.json" "$TC/event_story/event_colorcross_2025_rip/scenario/event_183_01.asset" "$TC/event_story/event_colorcross_2025_rip/scenario/event_183_01.json" "$JP/event_story/event_colorcross_2025/scenario/event_183_01.json" "$JP/event_story/event_colorcross_2025_rip/scenario/event_183_01.asset" "$JP/event_story/event_colorcross_2025_rip/scenario/event_183_01.json"; do probe "$u"; done
echo "== unit / card / talk / self / special =="
for u in "$TC/scenario/unitstory/piapro/vsleo_01_01.json" "$TC/scenario/unitstory/piapro_rip/vsleo_01_01.asset" "$JP/scenario/unitstory/piapro_rip/vsleo_01_01.asset" "$TC/character/member/res001_no001/001001_ichika01.json" "$TC/character/member/res001_no001_rip/001001_ichika01.asset" "$JP/character/member/res001_no001_rip/001001_ichika01.asset" "$TC/scenario/actionset/group0/as_cdshop_mob.json" "$TC/scenario/actionset/group0_rip/as_cdshop_mob.asset" "$JP/scenario/actionset/group0_rip/as_cdshop_mob.asset" "$TC/scenario/profile/self_ichika_2nd.json" "$TC/scenario/profile_rip/self_ichika_2nd.asset" "$JP/scenario/profile_rip/self_ichika_2nd.asset" "$TC/scenario/special/story_sp_ts_01_01/op_01.json" "$TC/scenario/special/story_sp_ts_01_01_rip/op_01.asset" "$JP/scenario/special/story_sp_ts_01_01_rip/op_01.asset"; do probe "$u"; done
echo "== background / voice from a real scenario =="
J=$(for u in "$TC/event_story/event_colorcross_2025/scenario/event_183_01.json" "$TC/event_story/event_colorcross_2025_rip/scenario/event_183_01.asset" "$JP/event_story/event_colorcross_2025_rip/scenario/event_183_01.asset" "$JP/event_story/event_colorcross_2025/scenario/event_183_01.json"; do b=$(curl -s -m 20 "$u"); if [ "${b:0:1}" = "{" ]; then echo "$b"; break; fi; done)
if [ -n "$J" ]; then
  BG=$(echo "$J" | jq -r '.FirstBackground // empty'); V=$(echo "$J" | jq -r '[.TalkData[].Voices[]?.VoiceId] | first // empty'); SID=$(echo "$J" | jq -r '.ScenarioId'); BODY=$(echo "$J" | jq -r '.TalkData[0].Body' | head -c 60)
  echo "scenario=$SID bg=$BG voice=$V body=$BODY"
  echo "$J" | jq -c '{keys: keys, snip0: .Snippets[0], talk0: (.TalkData[0] | {WindowDisplayName, TalkCharacters, Voices})}'
  for u in "$JP/scenario/background/$BG/$BG.webp" "$JP/scenario/background/${BG}_rip/$BG.webp" "$JP/sound/scenario/voice/$SID/$V.mp3" "$JP/sound/scenario/voice/${SID}_rip/$V.mp3" "$TC/sound/scenario/voice/${SID}_rip/$V.mp3"; do probe "$u"; done
else echo "no scenario json found"; fi
echo "== other new pages =="
FX=$(curl -s -m 20 "$MDB/mysekaiFixtures.json" | jq -r '.[0].assetbundleName'); MT=$(curl -s -m 20 "$MDB/mysekaiMaterials.json" | jq -r '.[0].iconAssetbundleName'); CM=$(curl -s -m 20 "$MDB/oneFrameComics.json" 2>/dev/null | jq -r '.[0].assetbundleName' 2>/dev/null); VL=$(curl -s -m 20 "$MDB/virtualLives.json" | jq -r '.[0].assetbundleName'); BGM=$(curl -s -m 20 "$MDB/bgms.json" 2>/dev/null | jq -r '.[0].assetbundleName' 2>/dev/null)
echo "fixture=$FX material=$MT comic=$CM vlive=$VL bgm=$BGM"
for u in "$JP/mysekai/thumbnail/fixture/${FX}_1.png" "$JP/mysekai/thumbnail/fixture_rip/${FX}_1.webp" "$JP/mysekai/thumbnail/fixture/${FX}_1.webp" "$JP/mysekai/thumbnail/material/$MT.png" "$JP/mysekai/thumbnail/material_rip/$MT.webp" "$JP/mysekai/thumbnail/material/$MT.webp" "$TC/comic/one_frame/$CM.webp" "$TC/comic/one_frame_rip/$CM.webp" "$JP/comic/one_frame_rip/$CM.webp" "$JP/comic/one_frame/$CM.webp" "$JP/virtual_live/select/banner/$VL/$VL.webp" "$JP/virtual_live/select/banner/${VL}_rip/$VL.webp" "$JP/thumbnail/material/material1.webp" "$JP/thumbnail/material_rip/material1.webp" "$JP/music/jacket/jacket_s_001/jacket_s_001.webp" "$JP/music/jacket/jacket_s_001_rip/jacket_s_001.webp" "$JP/character/member/res001_no001/card_normal.png" "$JP/character/member/res001_no001_rip/card_normal.webp"; do probe "$u"; done
echo "== ost =="
grep -o "sound/[^']*" /dev/null; true
