import { Route, Routes } from 'react-router-dom';
import { Nav } from './components/Nav.js';
import { Dashboard } from './routes/Dashboard.js';
import { BundleList } from './routes/BundleList.js';
import { BundleEditor } from './routes/BundleEditor.js';

export function App() {
  return (
    <div className="app-shell">
      <Nav />
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/bundles" element={<BundleList />} />
        <Route path="/bundles/:publicId" element={<BundleEditor />} />
      </Routes>
    </div>
  );
}
