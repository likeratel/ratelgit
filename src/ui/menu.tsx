import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";

export interface MenuItem {
  label: string;
  onSelect?: () => void;
  disabled?: boolean;
  destructive?: boolean;
  /** Draws a separator above this item. */
  separator?: boolean;
}

interface OpenMenu {
  x: number;
  y: number;
  items: MenuItem[];
}

/** Opens at the pointer for a mouse event, or at a given point. */
type Open = (
  at: MouseEvent | { x: number; y: number },
  items: MenuItem[],
) => void;

const MenuContext = createContext<Open>(() => undefined);

/** Opens the app's context menu at the pointer. */
export function useContextMenu(): Open {
  return useContext(MenuContext);
}

const EDGE = 8;

function MenuView({ menu, close }: { menu: OpenMenu; close: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: menu.x, top: menu.y });
  const enabled = menu.items.filter((item) => !item.disabled);
  const [active, setActive] = useState(-1);

  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setPosition({
      left: Math.max(
        EDGE,
        Math.min(menu.x, window.innerWidth - box.width - EDGE),
      ),
      top: Math.max(
        EDGE,
        Math.min(menu.y, window.innerHeight - box.height - EDGE),
      ),
    });
    ref.current?.focus();
  }, [menu]);

  const run = (item: MenuItem) => {
    close();
    item.onSelect?.();
  };

  return (
    <div
      className="menu-backdrop"
      onMouseDown={close}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        ref={ref}
        className="menu"
        role="menu"
        tabIndex={-1}
        style={position}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") close();
          if (event.key === "ArrowDown")
            setActive((a) => (a + 1) % enabled.length);
          if (event.key === "ArrowUp")
            setActive((a) => (a <= 0 ? enabled.length - 1 : a - 1));
          if (event.key === "Enter" && enabled[active]) run(enabled[active]);
          event.preventDefault();
        }}
      >
        {menu.items.map((item, index) => (
          <div key={`${item.label}-${index}`}>
            {item.separator ? <div className="menu-separator" /> : null}
            <button
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className={[
                "menu-item",
                item.destructive ? "destructive" : "",
                enabled[active] === item ? "active" : "",
              ].join(" ")}
              onClick={() => run(item)}
            >
              {item.label}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MenuProvider({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const open = useCallback<Open>((at, items) => {
    if ("preventDefault" in at) {
      at.preventDefault();
      at.stopPropagation();
      setMenu({ x: at.clientX, y: at.clientY, items });
      return;
    }
    setMenu({ x: at.x, y: at.y, items });
  }, []);
  const close = useCallback(() => setMenu(null), []);

  useEffect(() => {
    if (!menu) return;
    const onBlur = () => setMenu(null);
    window.addEventListener("blur", onBlur);
    window.addEventListener("resize", onBlur);
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", onBlur);
    };
  }, [menu]);

  return (
    <MenuContext.Provider value={open}>
      {children}
      {menu ? <MenuView menu={menu} close={close} /> : null}
    </MenuContext.Provider>
  );
}
