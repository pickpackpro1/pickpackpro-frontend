import React, { useState } from 'react'

import ClientHeader from '../ClientHeader';
import ClientSideBar from '../ClientSideBar';

function LayoutClient (props) {
    const { children } = props;
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen w-full overflow-hidden">
      {isSidebarOpen ? (
        <button
          type="button"
          aria-label="Close sidebar"
          onClick={() => setIsSidebarOpen(false)}
          className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden"
        />
      ) : null}

      <ClientSideBar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col"> 
        <ClientHeader onMenuClick={() => setIsSidebarOpen(true)} />
        <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-6"> 
          {children}
        </div>
      </div>
    </div>
  )
}

export default LayoutClient
