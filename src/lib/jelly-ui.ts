// Jelly UI's public bundle registers all 40 custom elements. Import only the
// six elements Briar renders so Vite can bundle them locally and tree-shake the
// rest of the upstream source.
import "jelly-ui-source/components/alert/index";
import "jelly-ui-source/components/button/index";
import "jelly-ui-source/components/card/index";
import "jelly-ui-source/components/input/index";
import "jelly-ui-source/components/select/index";
import "jelly-ui-source/components/switch/index";
import "jelly-ui-source/components/theme/index";
