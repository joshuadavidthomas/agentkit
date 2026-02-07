---
# agentkit-rbcc
title: Fix extra blank lines in RPC rendering (Spacer(1) from CustomMessageComponent)
status: completed
type: bug
priority: normal
created_at: 2026-02-07T14:42:58Z
updated_at: 2026-02-07T14:58:33Z
---

After reverting to RPC approach (commit 6b1bf77), the ralph_turn composite message has 2 extra blank lines compared to native pi rendering. The Spacer(1) in CustomMessageComponent's constructor adds a blank line above every custom message. With 3 sendMessage calls per iteration (header, turn, footer), we get more spacing than native. Need to investigate the exact source and find a workaround — possibly folding the header into the turn component, or finding a way to suppress/absorb the Spacer.