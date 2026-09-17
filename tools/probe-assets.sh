#!/usr/bin/env bash
JP=https://storage.sekai.best/sekai-jp-assets
TC=https://storage.sekai.best/sekai-tc-assets
ls() { echo "--- $1"; curl -s -m 20 "$1" | sed 's/<Contents>/\n<Contents>/g; s/<CommonPrefixes>/\n<CommonPrefixes>/g' | grep -o '<Key>[^<]*</Key>\|<Prefix>[^<]*</Prefix>' | head -${2:-12}; }
echo "== listings =="
ls "$JP/?list-type=2&prefix=scenario/unitstory/&delimiter=/&max-keys=30" 30
ls "$JP/?list-type=2&prefix=scenario/unitstory/unitstory_piapro/&max-keys=6"
ls "$JP/?list-type=2&prefix=scenario/actionset/&delimiter=/&max-keys=12"
ls "$JP/?list-type=2&prefix=scenario/actionset/group1/&max-keys=6"
ls "$JP/?list-type=2&prefix=scenario/actionset/group0/&max-keys=6"
ls "$JP/?list-type=2&prefix=scenario/special/&delimiter=/&max-keys=12"
ls "$JP/?list-type=2&prefix=scenario/special/story_sp_ts_01_01/&max-keys=6"
ls "$JP/?list-type=2&prefix=scenario/profile/&max-keys=5"
ls "$JP/?list-type=2&prefix=sound/scenario/voice/&delimiter=/&max-keys=5"
ls "$JP/?list-type=2&prefix=sound/scenario/voice/event_100_01/&max-keys=5"
ls "$JP/?list-type=2&prefix=sound/card_scenario/voice/&delimiter=/&max-keys=5"
ls "$JP/?list-type=2&prefix=sound/actionset/voice/&delimiter=/&max-keys=5"
ls "$JP/?list-type=2&prefix=comic/&delimiter=/&max-keys=10"
ls "$TC/?list-type=2&prefix=comic/one_frame/&max-keys=5"
ls "$JP/?list-type=2&prefix=sound/&delimiter=/&max-keys=20" 20
ls "$JP/?list-type=2&prefix=bgm/&delimiter=/&max-keys=10"
ls "$TC/?list-type=2&prefix=scenario/unitstory/&delimiter=/&max-keys=30" 30
echo "== .asset content & CORS =="
U="$TC/event_story/event_persona_2023/scenario/event_100_01.asset"
curl -s -m 20 "$U" | head -c 400; echo
echo "-- headers"; curl -s -m 20 -D - -o /dev/null -H 'Origin: https://project-sekai-center.com' "$U" | grep -i 'access-control\|content-type\|content-encoding'
echo "-- headers image"; curl -s -m 20 -D - -o /dev/null -H 'Origin: https://project-sekai-center.com' "$JP/scenario/background/bg_a000001/bg_a000001.webp" | grep -i 'access-control\|content-type'
echo "-- first talk"; curl -s -m 20 "$U" | python3 -c "import sys,json;d=json.load(sys.stdin);print(list(d.keys()));print(json.dumps(d['Snippets'][:3],ensure_ascii=False));print(json.dumps(d['TalkData'][0],ensure_ascii=False)[:400]);print('bg',d.get('FirstBackground'));print(json.dumps([x for x in d['SpecialEffectData'][:3]],ensure_ascii=False)[:400])"
V=$(curl -s -m 20 "$U" | python3 -c "import sys,json;d=json.load(sys.stdin);v=[x['Voices'][0]['VoiceId'] for x in d['TalkData'] if x.get('Voices')];print(v[0] if v else '')")
echo "voice=$V"
for u in "$JP/sound/scenario/voice/event_100_01/$V.mp3" "$JP/sound/scenario/voice/event_100_01_rip/$V.mp3" "$TC/sound/scenario/voice/event_100_01/$V.mp3"; do printf '%s ' "$(curl -s -o /dev/null -m 20 -w '%{http_code} %{content_type} %{size_download}' "$u")"; echo " $u"; done
