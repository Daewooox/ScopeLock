Output docs/assets/scopelock-demo.gif
Output .demo-vhs-out/scopelock-demo.mp4

Set FontSize 14
Set Width 960
Set Height 400
Set Theme "Dracula"
Set Padding 20

Hidden
Type "REPO=$(pwd); cd $(node $REPO/scripts/demo-vhs/setup-fixture.mjs guided); export PATH=\"$(pwd)/.demo-fake-bin:$PATH\"; clear"
Enter
Show

Type `scopelock task start "Add a dark mode toggle" --agent codex --allow src --yes`
Enter
Sleep 1.5s

Hidden
Type "node $REPO/scripts/demo-vhs/write-guided-source.mjs; clear"
Enter
Show

Type "scopelock task finish"
Enter
Sleep 2s
