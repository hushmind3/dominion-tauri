on run
	set repo to "/Users/gim-yeonsu/dominion-run"
	do shell script "cd " & quoted form of repo & " && /usr/bin/env zsh ./start-web.command >/dev/null 2>&1 &"
end run
