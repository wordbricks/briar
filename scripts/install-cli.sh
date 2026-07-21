#!/bin/sh
set -eu

binary_directory="$HOME/.local/bin"
library_directory="$HOME/.local/share/briar"
mkdir -p "$binary_directory" "$library_directory"
install -m 644 "$(dirname "$0")/../dist-cli/briar.js" "$library_directory/briar.js"
install -m 755 "$(dirname "$0")/briar-launcher" "$binary_directory/briar"
printf 'Installed Briar CLI at %s\n' "$binary_directory/briar"
