import { ProjectList } from "./ProjectList";
import { RefList } from "./RefList";

export function Sidebar() {
  return (
    <aside className="sidebar">
      <ProjectList />
      <RefList />
    </aside>
  );
}
