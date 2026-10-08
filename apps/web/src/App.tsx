import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { Header } from './components/Header.js';
import { BookScreen } from './screens/book/BookScreen.js';
import { BoardScreen } from './screens/board/index.js';
import { AppointmentsScreen } from './screens/list/index.js';
import { RecordScreen } from './screens/record/index.js';

function Layout() {
  return (
    <>
      <Header />
      <Outlet />
    </>
  );
}

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/book" replace />} />
        <Route path="/book" element={<BookScreen />} />
        <Route path="/appointments" element={<AppointmentsScreen />} />
        <Route path="/appointments/:reference" element={<RecordScreen />} />
        <Route path="/board" element={<BoardScreen />} />
        <Route path="*" element={<Navigate to="/book" replace />} />
      </Route>
    </Routes>
  );
}
