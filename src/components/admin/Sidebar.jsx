import { useMemo, useState } from "react";
import {
  Box,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileText,
  LayoutDashboard,
  LogOut,
  Package,
  PackageCheck,
  Settings,
  Tags,
  Truck,
  Users,
  X,
} from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";

const AUTH_STORAGE_KEY = "pickpackpro-auth";

const getSession = () => {
  const rawSession = localStorage.getItem(AUTH_STORAGE_KEY);

  if (!rawSession) {
    return null;
  }

  try {
    return JSON.parse(rawSession);
  } catch {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    return null;
  }
};

const clearSession = () => {
  localStorage.removeItem(AUTH_STORAGE_KEY);
};

const menuItems = [
  {
    section: "OVERVIEW",
    items: [{ id: "dashboard", label: "Dashboard", icon: LayoutDashboard, path: "/dashboard" }],
  },
  {
    section: "OPERATIONS",
    items: [
      { id: "shipments", label: "Shipments", icon: Package, path: "/shipments" },
      { id: "awaiting-fba-labels", label: "Awaiting FBA Labels", icon: Tags, path: "/awaiting-fba-labels" },
      { id: "receiving", label: "Receiving", icon: PackageCheck, path: "/receiving" },
      { id: "dispatch", label: "Dispatch", icon: Truck, path: "/dispatch" },
    ],
  },
  {
    section: "BUSINESS",
    items: [
      { id: "clients", label: "Clients", icon: Users, path: "/clients" },
      { id: "billing", label: "Billing", icon: FileText, path: "/billing" },
      { id: "products", label: "Products", icon: Box, path: "/products" },
    ],
  },
  {
    section: "SYSTEM",
    items: [
      { id: "audit-log", label: "Audit Log", icon: ClipboardList, path: "/audit-log" },
      { id: "settings", label: "Settings", icon: Settings, path: "/settings" },
    ],
  },
];

const SideBar = ({ isOpen = false, onClose = () => {} }) => {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const session = getSession();
  const showExpandedSidebar = isOpen || !collapsed;

  const initials = useMemo(() => {
    if (!session?.name) {
      return "AU";
    }

    return session.name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }, [session?.name]);

  const handleLogout = () => {
    clearSession();
    navigate("/login", { replace: true });
  };

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-50 flex h-screen w-64 flex-col border-r border-[#27458e] bg-[#2e4ea2] transition-all duration-300 lg:static lg:z-auto lg:translate-x-0 ${
        isOpen ? "translate-x-0" : "-translate-x-full"
      } ${
        collapsed ? "lg:w-16" : "lg:w-64"
      }`}
    >
      <div className="relative h-16 border-b border-[#27458e] flex items-center px-5">
        {showExpandedSidebar ? (
          
          <div className="flex items-center gap-3">
            {/* <div className="w-8 h-8 bg-[#ff8c2f] rounded-md flex items-center justify-center flex-shrink-0">
              <span className="text-[11px] font-bold text-white">PP</span>
            </div> */}

            <div className="text-left">
              <img src="/images/ppp-orange-logo-wide (1).webp" alt="PickPackPro Logo" className="h-7 w-auto mb-1" />
              {/* <h1 className="text-sm font-semibold text-white leading-tight">PickPackPro</h1> */}
              <p className="text-[10px] text-blue-100/80 uppercase tracking-wider">Admin Portal</p>
            </div>
          </div>
        ) : (
          <div className="w-9 h-9 bg-[#ff8c2f] rounded-md flex items-center justify-center">
            <span className="text-[11px] font-bold text-white">PP</span>
          </div>
        )}

        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute z-[99] -right-3 top-5 hidden bg-white border border-[#d6deef] rounded-full p-1 shadow hover:bg-[#f8fafc] text-[#64748b] lg:block"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>

        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-2 text-blue-100 transition-colors hover:bg-[#3a5bb2] hover:text-white lg:hidden"
          aria-label="Close sidebar menu"
        >
          <X size={18} />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto p-3 space-y-6 mt-2">
        {menuItems.map((section) => (
          <div key={section.section}>
            {showExpandedSidebar && (
              <p className="text-[10px] font-semibold text-blue-100/75 uppercase tracking-wider mb-2 px-3">
                {section.section}
              </p>
            )}

            <div className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path;

                return (
                  <Link
                    key={item.id}
                    to={item.path}
                    onClick={onClose}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors duration-200 ${
                      isActive
                        ? "bg-white text-[#2e4ea2] font-medium shadow-sm"
                        : "text-blue-50/90 hover:bg-[#3a5bb2] hover:text-white"
                    }`}
                  >
                    <Icon size={18} />
                    {showExpandedSidebar && <span className="text-sm">{item.label}</span>}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-[#27458e] bg-[#2a4796] p-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-[#ff8c2f] rounded-full flex items-center justify-center text-white font-semibold text-sm">
            {initials}
          </div>
          {showExpandedSidebar && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">
                {session?.name ?? "Admin User"}
              </p>
              <p className="text-xs text-blue-100/70 truncate">
                {session?.email ?? "admin@gmail.com"}
              </p>
            </div>
          )}
          <button
            type="button"
            onClick={handleLogout}
            className="p-1.5 rounded-lg hover:bg-[#3a5bb2] text-blue-100/80 hover:text-white transition-colors"
            title="Logout"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
};

export default SideBar;
