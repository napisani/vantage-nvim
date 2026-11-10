if exists('b:current_syntax')
  finish
endif

syntax spell toplevel
syntax match VantagePromptHeading /^\s*#\+\s.*$/
syntax region VantagePromptBold start=/\*\*/ end=/\*\*/ oneline
syntax region VantagePromptCode start=/`/ end=/`/ oneline
syntax region VantagePromptCodeBlock start=/^\s*```/ end=/^\s*```/ keepend
syntax match VantagePromptReference /@[[:alnum:]_.\/-]\+/
syntax match VantagePromptSkill /\%(^\|\s\)\zs\/[[:alnum:]][[:alnum:]-]*\%(:[[:alnum:]-]\+\)\?/

highlight default link VantagePromptHeading Title
highlight default link VantagePromptBold Bold
highlight default link VantagePromptCode String
highlight default link VantagePromptCodeBlock String
highlight default link VantagePromptReference Underlined
highlight default link VantagePromptSkill Special

let b:current_syntax = 'vantage_prompt'
