# Writing style

## Language
- **English first** for everything on GitHub: commit messages, PR titles and bodies, release notes, README, docs, and the repo description.
  - Korean versions are secondary files, such as `README.ko.md`.
- **The site follows the browser locale**: Korean for a Korean locale, English otherwise. A language picked in the UI overrides the locale and is remembered.
- **No emoji** anywhere: docs, commits, PRs, or UI text.
  - Use plain words in tables ("Yes" / "–").
  - Typographic symbols such as `·`, `×`, `→` (as a notation, not a sentence connector) and the `★` UI icon are fine.

## Korean register

The UI follows Apple's Korean interface and support pages: 합니다체 for sentences, 하십시오체 for instructions, and noun forms for short states. 해요체 is not used.

| Where | Form | Example |
| --- | --- | --- |
| Explanations, hints, errors, results | 합니다체 | 추천할 대상이 없습니다. / 새 판을 시작했습니다. |
| Instructions | 하십시오체 | 비밀번호를 입력하십시오. / 다시 시도하십시오. |
| Confirmation questions | -겠습니까? | 프로필을 삭제하겠습니까? |
| Short states, toasts, empty lists | Noun form (-음, -됨, ~ 없음) | 복사됨, 저장됨, 검색 결과 없음 |
| Buttons, titles, labels, tooltips | Noun phrase | 새 판, 밴 추천, 복구 코드 저장, 눌러서 금지 |
| Korean docs (`README.ko.md`) | 합니다체, including list items written as sentences | 영웅을 추천합니다. |

Never mix forms within one string, and don't let 해요체 (-어요, -세요) or 해라체 (-한다) slip into the UI. Code comments keep 해라체.

**Periods**
- Every full sentence ends with a period, even when it stands alone: 플레이어를 찾을 수 없습니다.
- Noun forms and noun phrases never take one: 검색 결과 없음
- Don't join two translated strings into one line in code. Render them as separate lines, so each string's punctuation stays correct. A name and a hint in one tooltip are joined with ` · `.

**Terms**
- Roles are 돌격 / 공격 / 지원, never 탱커 / 딜러 / 힐러.
- Spell auxiliary verbs with a space: 알려 줍니다, 적어 두십시오.

## Natural writing (no "AI tells")

Korean text is checked against [im-not-ai](https://github.com/epoko77-ai/im-not-ai) (`humanize-scan` / `humanize-korean`), English against Wikipedia's [Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing). The patterns that show up most here:
- **Contrast framing**: "not A but B", "A가 아니라 B", "X shows numbers. We tell you what to do." State what the thing does. Keep a contrast only when the reader would otherwise assume A, and use it at most once per document.
- **Dashes and arrows as connectors** (`—`, `→`). Split the sentence or use a connective ending. `→` is fine as notation (`ㄹㅇ` → 라인하르트).
- **Hooks and slogans**: rhetorical questions as openers ("지금 이 판, 뭐 하지?"), bolded taglines. Start with what the product does.
- **Intensifiers and stock words**: 전혀, 매우, 정말, 핵심, 다양한, 혁신적인; seamless, robust, crucial, simply.
- **Fragment lists**: "No injection. No memory reads. No packets." Write one sentence.
- **Bold on every key word** in prose. Bold a list item's lead term, not words inside sentences.
- **Korean specifics**:
  - No comma right after a connective ending (-고, -며, -지만, -면서, -아서, -어서): "모으고 실제…", not "모으고, 실제…".
  - Avoid translationese: "~를 통해", "~에 대해", "~에 있어서", "~기반" / "~를 바탕으로" (→ "~로 만든"), "~을 위해" (→ "~하려면"), double passives, "가지고 있다" for adjectives.

Keep the facts, numbers and product names exactly as they are when rewriting.
