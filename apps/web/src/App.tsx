import { Route, Routes } from "react-router-dom";
import { Landing } from "./pages/Landing";

export function App() {
  return (
    <Routes>
      <Route path="*" element={<Landing />} />
    </Routes>
  );
}
