// The web editor (lensprout.myudak.com/editor/): the extension's library and editor without the
// recorder. Videos are imported from disk; see src/platform.ts for what differs.
import { createRoot } from 'react-dom/client';
import { Library } from '../src/ui/Library';
import { Editor } from '../src/ui/Editor';
import { AppProviders } from '../src/components/app/app';
import '../src/ui/globals.css';
const id = new URLSearchParams(location.search).get('project');
createRoot(document.getElementById('root')!).render(
  <AppProviders>{id ? <Editor id={id} /> : <Library />}</AppProviders>,
);
