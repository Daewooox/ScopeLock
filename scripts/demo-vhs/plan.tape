Output docs/assets/scopelock-plan-demo.gif
Output .demo-vhs-out/scopelock-plan-demo.mp4

Set FontSize 14
Set Width 960
Set Height 300
Set Theme "Dracula"
Set Padding 20

Hidden
Type "REPO=$(pwd); cd $(node \"$REPO\"/scripts/demo-vhs/setup-fixture.mjs plan); export PATH=\"$(pwd)/.demo-fake-bin:$PATH\"; clear"
Enter
Show

Type `scopelock plan prepare plan.json --target codex --out ready.json --validation-command node -e "process.exit(0)"`
Enter
Sleep 2s
