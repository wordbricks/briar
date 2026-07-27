#!/bin/sh
set -eu

binary_directory="$HOME/.local/bin"
library_directory="$HOME/.local/share/briar"
skill_directory="$HOME/.codex/skills/briar-workflow"
mkdir -p "$binary_directory" "$library_directory" "$skill_directory"
install -m 644 "$(dirname "$0")/../dist-cli/briar.js" "$library_directory/briar.js"
install -m 644 "$(dirname "$0")/../skills/briar-workflow/VERSION" "$library_directory/VERSION"
install -m 755 "$(dirname "$0")/briar-launcher" "$binary_directory/briar"
skill_source="$(cd "$(dirname "$0")/../skills/briar-workflow" && pwd -P)"
skill_destination="$(cd "$skill_directory" && pwd -P)"
if [ "$skill_source" != "$skill_destination" ]; then
  rm -rf "$skill_directory/references"
  cp -R "$skill_source/." "$skill_directory/"
fi
chmod 755 "$skill_directory/scripts/briar"
printf 'Installed Briar CLI at %s\n' "$binary_directory/briar"
printf 'Installed Briar Workflow skill at %s\n' "$skill_directory"
