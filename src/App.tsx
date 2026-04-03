import React, { useState, useEffect } from 'react';
import { 
  collection, 
  query, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  doc, 
  getDocs, 
  orderBy,
  Timestamp,
  getDoc
} from 'firebase/firestore';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  User 
} from 'firebase/auth';
import { db, auth } from './firebase';
import { Script, Client, Log, ScriptStatus } from './types';
import { classifyClientResponse, formatApprovalMessage } from './services/geminiService';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Plus, 
  Search, 
  Clock, 
  CheckCircle, 
  AlertCircle, 
  MessageSquare, 
  Send, 
  User as UserIcon, 
  ArrowRight,
  History,
  FileText,
  Users,
  Bell,
  RefreshCw
} from 'lucide-react';
import { format, addHours, isAfter, parseISO } from 'date-fns';
import ReactMarkdown from 'react-markdown';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "Something went wrong.";
      try {
        const parsed = JSON.parse(this.state.error?.message || "{}");
        if (parsed.error) errorMessage = parsed.error;
      } catch (e) {
        errorMessage = this.state.error?.message || errorMessage;
      }

      return (
        <div className="flex flex-col items-center justify-center h-screen bg-slate-50 p-4 text-center">
          <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full">
            <AlertCircle className="w-12 h-12 text-rose-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-slate-900 mb-2">Application Error</h2>
            <p className="text-slate-600 mb-6">{errorMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

function AppContent() {
  const [user, setUser] = useState<User | null>(null);
  const [scripts, setScripts] = useState<Script[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'scripts' | 'clients'>('dashboard');
  const [showAddScript, setShowAddScript] = useState(false);
  const [showAddClient, setShowAddClient] = useState(false);
  const [selectedScript, setSelectedScript] = useState<Script | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);

  // Auth
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const login = () => {
    const provider = new GoogleAuthProvider();
    signInWithPopup(auth, provider);
  };

  // Data Fetching
  useEffect(() => {
    if (!user) return;

    const qScripts = query(collection(db, 'scripts'), orderBy('updatedAt', 'desc'));
    const unsubScripts = onSnapshot(qScripts, (snapshot) => {
      setScripts(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Script)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'scripts');
    });

    const qClients = query(collection(db, 'clients'), orderBy('name', 'asc'));
    const unsubClients = onSnapshot(qClients, (snapshot) => {
      setClients(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Client)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'clients');
    });

    return () => {
      unsubScripts();
      unsubClients();
    };
  }, [user]);

  // Logs Fetching
  useEffect(() => {
    if (!selectedScript) return;
    const qLogs = query(collection(db, `scripts/${selectedScript.id}/logs`), orderBy('timestamp', 'desc'));
    const unsubLogs = onSnapshot(qLogs, (snapshot) => {
      setLogs(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Log)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `scripts/${selectedScript.id}/logs`);
    });
    return () => unsubLogs();
  }, [selectedScript]);

  const addScript = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const clientId = formData.get('clientId') as string;
    const client = clients.find(c => c.id === clientId);
    if (!client) return;

    const newScript = {
      title: formData.get('title') as string,
      content: formData.get('content') as string,
      status: 'Ready for Approval' as ScriptStatus,
      version: 1,
      clientId,
      writerId: user?.uid || 'unknown',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      followUpCount: 0,
    };

    try {
      const docRef = await addDoc(collection(db, 'scripts'), newScript);
      await addDoc(collection(db, `scripts/${docRef.id}/logs`), {
        scriptId: docRef.id,
        timestamp: new Date().toISOString(),
        action: 'Created',
        message: `Script "${newScript.title}" created by ${user?.displayName}.`
      });
      setShowAddScript(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'scripts');
    }
  };

  const addClient = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const newClient = {
      name: formData.get('name') as string,
      email: formData.get('email') as string,
      phone: formData.get('phone') as string,
      preferredChannel: formData.get('preferredChannel') as 'WhatsApp' | 'Email',
      slaHours: parseInt(formData.get('slaHours') as string) || 48,
    };
    try {
      await addDoc(collection(db, 'clients'), newClient);
      setShowAddClient(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'clients');
    }
  };

  const sendApprovalRequest = async (script: Script) => {
    const client = clients.find(c => c.id === script.clientId);
    if (!client) return;

    const deadline = addHours(new Date(), client.slaHours).toISOString();
    const message = await formatApprovalMessage(script, client.name, client.preferredChannel, format(parseISO(deadline), 'PPp'));

    try {
      await updateDoc(doc(db, 'scripts', script.id), {
        status: 'Waiting for Feedback',
        responseDeadline: deadline,
        updatedAt: new Date().toISOString(),
      });

      await addDoc(collection(db, `scripts/${script.id}/logs`), {
        scriptId: script.id,
        timestamp: new Date().toISOString(),
        action: 'Request Sent',
        message: `Approval request sent via ${client.preferredChannel}.`,
        channel: client.preferredChannel
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `scripts/${script.id}`);
    }
  };

  const simulateClientResponse = async (script: Script, responseText: string) => {
    const classification = await classifyClientResponse(responseText);
    
    let newStatus: ScriptStatus = script.status;
    let logMessage = `Client responded: "${responseText}". Classified as: ${classification.classification}.`;

    if (classification.classification === 'Approved') {
      newStatus = 'Approved';
    } else if (classification.classification === 'Revision Requested') {
      newStatus = 'Revision Requested';
      logMessage += ` Revision notes: ${classification.revisionNotes}`;
    } else if (classification.classification === 'Rejected') {
      newStatus = 'Rejected';
    } else if (classification.classification === 'Call Requested') {
      newStatus = 'Call Requested';
    }

    try {
      await updateDoc(doc(db, 'scripts', script.id), {
        status: newStatus,
        updatedAt: new Date().toISOString(),
      });

      await addDoc(collection(db, `scripts/${script.id}/logs`), {
        scriptId: script.id,
        timestamp: new Date().toISOString(),
        action: 'Response Received',
        message: logMessage
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `scripts/${script.id}`);
    }

    if (classification.classification === 'Revision Requested') {
      // Create revision task logic could go here
    }
  };

  const checkFollowUps = async () => {
    const now = new Date();
    for (const script of scripts) {
      if (script.status === 'Waiting for Feedback' && script.responseDeadline) {
        const deadline = parseISO(script.responseDeadline);
        const hoursSinceLast = script.lastFollowUpAt 
          ? (now.getTime() - parseISO(script.lastFollowUpAt).getTime()) / (1000 * 60 * 60)
          : (now.getTime() - parseISO(script.updatedAt).getTime()) / (1000 * 60 * 60);

        // Simple simulation logic: check every 24h
        if (hoursSinceLast >= 24) {
          let newFollowUpCount = script.followUpCount + 1;
          let newStatus: ScriptStatus = script.status;
          let action = '';
          let message = '';

          if (newFollowUpCount === 1) {
            action = 'Follow-up 1';
            message = '24h follow-up sent to client.';
          } else if (newFollowUpCount === 2) {
            action = 'Follow-up 2';
            message = '48h follow-up sent to client. Production blocked.';
          } else if (newFollowUpCount >= 3) {
            action = 'Escalated';
            message = '72h escalation to account manager triggered.';
            newStatus = 'Escalated';
          }

          if (action) {
            try {
              await updateDoc(doc(db, 'scripts', script.id), {
                followUpCount: newFollowUpCount,
                status: newStatus,
                lastFollowUpAt: now.toISOString(),
                updatedAt: now.toISOString(),
              });
              await addDoc(collection(db, `scripts/${script.id}/logs`), {
                scriptId: script.id,
                timestamp: now.toISOString(),
                action,
                message
              });
            } catch (error) {
              handleFirestoreError(error, OperationType.UPDATE, `scripts/${script.id}`);
            }
          }
        }
      }
    }
  };

  if (loading) return <div className="flex items-center justify-center h-screen bg-slate-50">Loading...</div>;

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-50 p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white p-8 rounded-2xl shadow-xl text-center"
        >
          <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <FileText className="text-white w-8 h-8" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Scrollhouse</h1>
          <p className="text-slate-500 mb-8">Content Approval Agent & Tracker</p>
          <button 
            onClick={login}
            className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-2"
          >
            <UserIcon size={20} />
            Sign in with Google
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col">
        <div className="p-6 border-b border-slate-100">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <FileText className="text-white w-5 h-5" />
            </div>
            <span className="font-bold text-slate-900 text-xl tracking-tight">Scrollhouse</span>
          </div>
          <p className="text-xs text-slate-400 font-medium uppercase tracking-widest">Approval Loop</p>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          <SidebarItem 
            icon={<Clock size={20} />} 
            label="Dashboard" 
            active={activeTab === 'dashboard'} 
            onClick={() => setActiveTab('dashboard')} 
          />
          <SidebarItem 
            icon={<FileText size={20} />} 
            label="Scripts" 
            active={activeTab === 'scripts'} 
            onClick={() => setActiveTab('scripts')} 
          />
          <SidebarItem 
            icon={<Users size={20} />} 
            label="Clients" 
            active={activeTab === 'clients'} 
            onClick={() => setActiveTab('clients')} 
          />
        </nav>

        <div className="p-4 border-t border-slate-100">
          <div className="flex items-center gap-3 p-2">
            <img src={user.photoURL || ''} alt="" className="w-8 h-8 rounded-full" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-900 truncate">{user.displayName}</p>
              <button onClick={() => auth.signOut()} className="text-xs text-slate-500 hover:text-indigo-600">Sign out</button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8">
          <h2 className="text-lg font-bold text-slate-900 capitalize">{activeTab}</h2>
          <div className="flex items-center gap-4">
            <button 
              onClick={checkFollowUps}
              className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors flex items-center gap-2 text-sm font-medium"
              title="Manually trigger follow-up check"
            >
              <RefreshCw size={18} />
              Sync Loop
            </button>
            <button className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg">
              <Bell size={20} />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8">
          {activeTab === 'dashboard' && (
            <div className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <StatCard 
                  label="Active Loops" 
                  value={scripts.filter(s => s.status === 'Waiting for Feedback').length} 
                  icon={<Clock className="text-amber-500" />}
                />
                <StatCard 
                  label="Approved (This Month)" 
                  value={scripts.filter(s => s.status === 'Approved').length} 
                  icon={<CheckCircle className="text-emerald-500" />}
                />
                <StatCard 
                  label="Escalations" 
                  value={scripts.filter(s => s.status === 'Escalated').length} 
                  icon={<AlertCircle className="text-rose-500" />}
                />
              </div>

              <section>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Recent Activity</h3>
                </div>
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Script</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Client</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Status</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Deadline</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {scripts.slice(0, 10).map(script => (
                        <tr key={script.id} className="hover:bg-slate-50 transition-colors cursor-pointer" onClick={() => setSelectedScript(script)}>
                          <td className="px-6 py-4">
                            <p className="font-semibold text-slate-900">{script.title}</p>
                            <p className="text-xs text-slate-400">v{script.version}</p>
                          </td>
                          <td className="px-6 py-4">
                            <p className="text-sm text-slate-600">{clients.find(c => c.id === script.clientId)?.name}</p>
                          </td>
                          <td className="px-6 py-4">
                            <StatusBadge status={script.status} />
                          </td>
                          <td className="px-6 py-4">
                            <p className="text-sm text-slate-600">
                              {script.responseDeadline ? format(parseISO(script.responseDeadline), 'MMM d, p') : '-'}
                            </p>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <ArrowRight size={18} className="text-slate-300" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          )}

          {activeTab === 'scripts' && (
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <div className="relative w-96">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                  <input 
                    type="text" 
                    placeholder="Search scripts..." 
                    className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                  />
                </div>
                <button 
                  onClick={() => setShowAddScript(true)}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl font-semibold flex items-center gap-2 transition-all"
                >
                  <Plus size={20} />
                  New Script
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                {scripts.map(script => (
                  <ScriptCard 
                    key={script.id} 
                    script={script} 
                    client={clients.find(c => c.id === script.clientId)} 
                    onClick={() => setSelectedScript(script)}
                  />
                ))}
              </div>
            </div>
          )}

          {activeTab === 'clients' && (
            <div className="space-y-6">
              <div className="flex justify-end">
                <button 
                  onClick={() => setShowAddClient(true)}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl font-semibold flex items-center gap-2 transition-all"
                >
                  <Plus size={20} />
                  Add Client
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {clients.map(client => (
                  <div key={client.id} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                    <div className="flex items-center gap-4 mb-4">
                      <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center font-bold text-lg">
                        {client.name.charAt(0)}
                      </div>
                      <div>
                        <h3 className="font-bold text-slate-900">{client.name}</h3>
                        <p className="text-sm text-slate-500">{client.preferredChannel}</p>
                      </div>
                    </div>
                    <div className="space-y-2 text-sm text-slate-600">
                      <p className="flex items-center gap-2"><MessageSquare size={16} /> {client.email}</p>
                      <p className="flex items-center gap-2"><Clock size={16} /> {client.slaHours}h SLA</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Modals */}
      <AnimatePresence>
        {showAddScript && (
          <Modal title="Submit New Script" onClose={() => setShowAddScript(false)}>
            <form onSubmit={addScript} className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Title</label>
                <input name="title" required className="w-full px-4 py-2 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Client</label>
                <select name="clientId" required className="w-full px-4 py-2 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="">Select a client</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Content (Markdown supported)</label>
                <textarea name="content" required rows={6} className="w-full px-4 py-2 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-sm"></textarea>
              </div>
              <button type="submit" className="w-full bg-indigo-600 text-white py-3 rounded-xl font-bold hover:bg-indigo-700 transition-all">Submit for Approval</button>
            </form>
          </Modal>
        )}

        {showAddClient && (
          <Modal title="Add New Client" onClose={() => setShowAddClient(false)}>
            <form onSubmit={addClient} className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Client Name</label>
                <input name="name" required className="w-full px-4 py-2 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Email</label>
                  <input name="email" type="email" required className="w-full px-4 py-2 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Phone</label>
                  <input name="phone" className="w-full px-4 py-2 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Channel</label>
                  <select name="preferredChannel" className="w-full px-4 py-2 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500">
                    <option value="WhatsApp">WhatsApp</option>
                    <option value="Email">Email</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">SLA (Hours)</label>
                  <input name="slaHours" type="number" defaultValue={48} className="w-full px-4 py-2 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
              <button type="submit" className="w-full bg-indigo-600 text-white py-3 rounded-xl font-bold hover:bg-indigo-700 transition-all">Save Client</button>
            </form>
          </Modal>
        )}

        {selectedScript && (
          <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/20 backdrop-blur-sm">
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="w-full max-w-2xl h-full bg-white shadow-2xl flex flex-col"
            >
              <div className="p-6 border-b border-slate-200 flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-bold text-slate-900">{selectedScript.title}</h3>
                  <p className="text-sm text-slate-500">v{selectedScript.version} • {clients.find(c => c.id === selectedScript.clientId)?.name}</p>
                </div>
                <button onClick={() => setSelectedScript(null)} className="p-2 hover:bg-slate-100 rounded-lg">
                  <Plus className="rotate-45 text-slate-400" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-8">
                <section>
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Script Content</h4>
                    <StatusBadge status={selectedScript.status} />
                  </div>
                  <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 prose prose-slate max-w-none">
                    <ReactMarkdown>{selectedScript.content}</ReactMarkdown>
                  </div>
                </section>

                <section>
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Actions</h4>
                  <div className="flex flex-wrap gap-3">
                    {selectedScript.status === 'Ready for Approval' && (
                      <button 
                        onClick={() => sendApprovalRequest(selectedScript)}
                        className="bg-indigo-600 text-white px-6 py-2 rounded-xl font-bold flex items-center gap-2 hover:bg-indigo-700 transition-all"
                      >
                        <Send size={18} /> Send to Client
                      </button>
                    )}
                    {selectedScript.status === 'Waiting for Feedback' && (
                      <div className="w-full space-y-4">
                        <p className="text-sm text-slate-500 italic">Simulate client response to test the agentic loop:</p>
                        <div className="flex gap-2">
                          <button onClick={() => simulateClientResponse(selectedScript, "Looks good! Approved.")} className="px-4 py-2 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-sm font-bold hover:bg-emerald-100">👍 Approved</button>
                          <button onClick={() => simulateClientResponse(selectedScript, "Can we change the intro? It's too slow.")} className="px-4 py-2 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg text-sm font-bold hover:bg-amber-100">📝 Revisions</button>
                          <button onClick={() => simulateClientResponse(selectedScript, "I'm not sure about this. Let's hop on a call.")} className="px-4 py-2 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg text-sm font-bold hover:bg-blue-100">📞 Call Req</button>
                        </div>
                      </div>
                    )}
                  </div>
                </section>

                <section>
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Activity Log</h4>
                  <div className="space-y-4">
                    {logs.map(log => (
                      <div key={log.id} className="flex gap-4">
                        <div className="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center flex-shrink-0">
                          <History size={14} className="text-slate-400" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-900">{log.action}</p>
                          <p className="text-sm text-slate-600">{log.message}</p>
                          <p className="text-xs text-slate-400 mt-1">{format(parseISO(log.timestamp), 'MMM d, p')}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SidebarItem({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active?: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-medium ${
        active 
          ? 'bg-indigo-50 text-indigo-600' 
          : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function StatCard({ label, value, icon }: { label: string, value: number, icon: React.ReactNode }) {
  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-bold text-slate-400 uppercase tracking-widest">{label}</span>
        <div className="p-2 bg-slate-50 rounded-lg">{icon}</div>
      </div>
      <p className="text-3xl font-bold text-slate-900">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: ScriptStatus }) {
  const styles = {
    'Ready for Approval': 'bg-slate-100 text-slate-600',
    'Waiting for Feedback': 'bg-amber-100 text-amber-700',
    'Approved': 'bg-emerald-100 text-emerald-700',
    'Revision Requested': 'bg-indigo-100 text-indigo-700',
    'Rejected': 'bg-rose-100 text-rose-700',
    'Escalated': 'bg-rose-500 text-white',
    'Call Requested': 'bg-blue-100 text-blue-700',
  };

  return (
    <span className={`px-3 py-1 rounded-full text-xs font-bold ${styles[status]}`}>
      {status}
    </span>
  );
}

function ScriptCard({ script, client, onClick }: { script: Script, client?: Client, onClick: () => void }) {
  return (
    <motion.div 
      whileHover={{ y: -4 }}
      onClick={onClick}
      className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm cursor-pointer hover:shadow-md transition-all"
    >
      <div className="flex justify-between items-start mb-4">
        <StatusBadge status={script.status} />
        <span className="text-xs font-bold text-slate-400">v{script.version}</span>
      </div>
      <h3 className="font-bold text-slate-900 mb-1 truncate">{script.title}</h3>
      <p className="text-sm text-slate-500 mb-4">{client?.name || 'Unknown Client'}</p>
      <div className="flex items-center justify-between pt-4 border-t border-slate-100">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Clock size={14} />
          {format(parseISO(script.updatedAt), 'MMM d')}
        </div>
        <ArrowRight size={16} className="text-slate-300" />
      </div>
    </motion.div>
  );
}

function Modal({ title, children, onClose }: { title: string, children: React.ReactNode, onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden"
      >
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-xl font-bold text-slate-900">{title}</h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg">
            <Plus className="rotate-45 text-slate-400" />
          </button>
        </div>
        <div className="p-6">
          {children}
        </div>
      </motion.div>
    </div>
  );
}
