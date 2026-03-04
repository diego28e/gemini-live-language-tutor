import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Classroom from './pages/Classroom';

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-[#0f1115] text-white selection:bg-indigo-500/30 font-sans antialiased">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/classroom/:lessonId" element={<Classroom />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
