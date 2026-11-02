// Trusted bootstrap only. No workload instruction executes before job assignment.
// Build with the existing Windows .NET compiler; never run as an offline fixture.
using System;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

public class JobGuardian {
  const uint SUSPENDED=4, NEW_GROUP=0x200, BAD_LIMITS=0x800|0x1000|0x2000;
  static JavaScriptSerializer json=new JavaScriptSerializer { MaxJsonLength=16777216 };
  // A keyboard CTRL_C/CTRL_BREAK on the shared console must not kill the guardian:
  // its job handle is the only name for the family. Close/logoff/shutdown fall through.
  delegate bool CtrlHandler(uint type);
  static readonly CtrlHandler IgnoreInterrupts=t => t==0 || t==1;
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct Startup {
    public uint cb; public string reserved,desktop,title; public uint x,y,w,h,cx,cy,fill,flags;
    public ushort show,reserved2; public IntPtr bytes,input,output,error;
  }
  [StructLayout(LayoutKind.Sequential)] struct Proc {public IntPtr process,thread;public uint pid,tid;}
  [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
    public long processTime,jobTime; public uint flags; public UIntPtr minWorking,maxWorking;
    public uint active; public UIntPtr affinity; public uint priority,scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct IO {public ulong a,b,c,d,e,f;}
  [StructLayout(LayoutKind.Sequential)] struct Limits {public BasicLimits basic;public IO io;public UIntPtr a,b,c,d;}
  [StructLayout(LayoutKind.Sequential)] struct Accounting {public long a,b,c,d; public uint faults,total,active,terminated;}
  [DllImport("kernel32",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr security,string name);
  [DllImport("kernel32",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr OpenJobObject(uint access,bool inherit,string name);
  [DllImport("kernel32",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int cls,ref Limits value,uint size);
  [DllImport("kernel32",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int cls,IntPtr buffer,uint size,IntPtr length);
  [DllImport("kernel32",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32",SetLastError=true)] static extern bool IsProcessInJob(IntPtr process,IntPtr job,out bool result);
  [DllImport("kernel32",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string exe,StringBuilder command,IntPtr psa,IntPtr tsa,bool inherit,uint flags,IntPtr env,string cwd,ref Startup startup,out Proc proc);
  [DllImport("kernel32",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32",SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint code);
  [DllImport("kernel32",SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
  [DllImport("kernel32",SetLastError=true)] static extern bool GetProcessTimes(IntPtr process,out long created,out long exit,out long kernel,out long user);
  [DllImport("kernel32",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
  [DllImport("kernel32",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
  [DllImport("kernel32")] static extern IntPtr GetStdHandle(int which);
  [DllImport("kernel32",SetLastError=true)] static extern bool SetStdHandle(int which,IntPtr handle);
  [DllImport("kernel32")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32",SetLastError=true)] static extern bool AttachConsole(uint pid);
  [DllImport("kernel32")] static extern bool FreeConsole();
  [DllImport("kernel32",SetLastError=true)] static extern bool GenerateConsoleCtrlEvent(uint type,uint group);
  [DllImport("kernel32")] static extern bool SetConsoleCtrlHandler(IntPtr handler,bool add);
  [DllImport("kernel32",SetLastError=true)] static extern bool SetConsoleCtrlHandler(CtrlHandler handler,bool add);
  static void Check(bool ok) {if(!ok) throw new Win32Exception(Marshal.GetLastWin32Error());}
  static Dictionary<string,object> Read(string p) {return json.Deserialize<Dictionary<string,object>>(File.ReadAllText(p));}
  static string S(Dictionary<string,object> c,string k) {return Convert.ToString(c[k]);}
  static string Job(Dictionary<string,object> c) {return "Local\\StarqJob_"+S(c,"instance");}
  static string Signature(Dictionary<string,object> c,string kind,string payload) {
    using(var h=new HMACSHA256(Encoding.UTF8.GetBytes(S(c,"token")))) return BitConverter.ToString(h.ComputeHash(Encoding.UTF8.GetBytes(kind+"|"+S(c,"instance")+"|"+payload))).Replace("-","").ToLowerInvariant();
  }
  static void Receipt(Dictionary<string,object> c,string kind,Dictionary<string,object> body) {
    string payload=json.Serialize(body), file=S(c,"directory")+"\\"+kind+".json";
    if(File.Exists(file)) throw new Exception("receipt already exists");
    File.WriteAllText(file+".tmp",json.Serialize(new {payload=payload,mac=Signature(c,kind,payload)}),new UTF8Encoding(false));
    File.Move(file+".tmp",file);
  }
  static Dictionary<string,object> Verified(Dictionary<string,object> c,string kind) {
    var r=Read(S(c,"directory")+"\\"+kind+".json"); string payload=S(r,"payload");
    if(S(r,"mac")!=Signature(c,kind,payload)) throw new Exception("receipt authentication failed");
    return json.Deserialize<Dictionary<string,object>>(payload);
  }
  public static string Quote(string s) {
    var b=new StringBuilder("\""); int slashes=0;
    foreach(char ch in s) {if(ch=='\\'){slashes++;continue;} if(ch=='\"'){b.Append('\\',slashes*2+1);b.Append(ch);}else{b.Append('\\',slashes);b.Append(ch);} slashes=0;}
    b.Append('\\',slashes*2);return b.Append('"').ToString();
  }
  static long CreatedRaw(IntPtr p) {long a,b,d,e;Check(GetProcessTimes(p,out a,out b,out d,out e));return a;}
  static long Created(IntPtr p) {return (CreatedRaw(p)-116444736000000000L)/10000;}
  static T Info<T>(IntPtr j,int cls) {int n=Marshal.SizeOf(typeof(T));IntPtr b=Marshal.AllocHGlobal(n);try{Check(QueryInformationJobObject(j,cls,b,(uint)n,IntPtr.Zero));return (T)Marshal.PtrToStructure(b,typeof(T));}finally{Marshal.FreeHGlobal(b);}}
  static uint Active(IntPtr j) {return Info<Accounting>(j,1).active;}
  static void SafeLimits(IntPtr j) {if((Info<Limits>(j,9).basic.flags & BAD_LIMITS)!=0) throw new Exception("breakaway or kill-on-close flags are unsafe");}
  static bool GuardianGone(Dictionary<string,object> start) {
    IntPtr h=OpenProcess(0x1000,false,Convert.ToUInt32(start["guardian_pid"]));
    if(h==IntPtr.Zero) {int err=Marshal.GetLastWin32Error();if(err==87) return true;throw new Win32Exception(err);}
    try{uint code;Check(GetExitCodeProcess(h,out code));return CreatedRaw(h)!=Convert.ToInt64(start["guardian_created_filetime"]) || code!=259;}finally{CloseHandle(h);}
  }
  static bool RootGone(Dictionary<string,object> start) {
    IntPtr h=OpenProcess(0x1000,false,Convert.ToUInt32(start["root_pid"]));
    if(h==IntPtr.Zero) {int err=Marshal.GetLastWin32Error();if(err==87) return true;throw new Win32Exception(err);}
    try{uint code;Check(GetExitCodeProcess(h,out code));return CreatedRaw(h)!=Convert.ToInt64(start["root_created_filetime"]) || code!=259;}finally{CloseHandle(h);}
  }
  static Dictionary<string,object> Status(Dictionary<string,object> c,IntPtr j,Dictionary<string,object> start) {
    if(j==IntPtr.Zero) {
      var closed=Verified(c,"closed");
      if(Convert.ToInt32(closed["active"])!=0 || Convert.ToInt64(closed["root_pid"])!=Convert.ToInt64(start["root_pid"]))throw new Exception("invalid empty-family receipt");
      bool closedGuardianGone=GuardianGone(start),closedRootGone=RootGone(start),closedFamilyGone=closedGuardianGone&&closedRootGone;
      return new Dictionary<string,object>{{"owned",true},{"active",0},{"closed",closedFamilyGone},{"guardian_gone",closedGuardianGone},{"root_gone",closedRootGone},{"basis",Convert.ToString(closed["basis"])}};
    }
    SafeLimits(j); uint active=Active(j);
    bool guardianGone=active==0 && GuardianGone(start),rootGone=active==0 && RootGone(start);
    return new Dictionary<string,object>{{"owned",true},{"active",active},{"closed",active==0 && guardianGone && rootGone},{"guardian_gone",guardianGone},{"root_gone",rootGone},{"basis","kernel job accounting"}};
  }
  static int Launch(Dictionary<string,object> c) {
    Check(SetConsoleCtrlHandler(IgnoreInterrupts,true)); // before any job or process exists
    IntPtr job=CreateJobObject(IntPtr.Zero,Job(c));int createError=Marshal.GetLastWin32Error();
    if(job==IntPtr.Zero)throw new Win32Exception(createError);
    if(createError==183){CloseHandle(job);throw new Exception("job already exists; never adopt");}
    Proc p=new Proc(); bool resumed=false;
    try {
      var limits=new Limits(); // no breakaway, no silent breakaway, no kill-on-close
      Check(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(Limits))));SafeLimits(job);
      var command=new StringBuilder(Quote(S(c,"exe"))); foreach(object arg in (IEnumerable)c["args"])command.Append(" "+Quote(Convert.ToString(arg)));
      var si=new Startup();si.cb=(uint)Marshal.SizeOf(typeof(Startup));si.flags=0x101;si.input=GetStdHandle(-10);si.output=GetStdHandle(-11);si.error=GetStdHandle(-12);
      // The workload inherits this guardian's environment, which the launcher set;
      // the environment is never written into the on-disk descriptor.
      Check(CreateProcess(S(c,"exe"),command,IntPtr.Zero,IntPtr.Zero,true,SUSPENDED|NEW_GROUP,IntPtr.Zero,S(c,"cwd"),ref si,out p));
      Check(AssignProcessToJobObject(job,p.process));bool member;Check(IsProcessInJob(p.process,job,out member));if(!member)throw new Exception("assignment not verified");
      var self=Process.GetCurrentProcess();
      Receipt(c,"started",new Dictionary<string,object>{{"root_pid",p.pid},{"root_created_ms",Created(p.process)},{"root_created_filetime",CreatedRaw(p.process).ToString()},{"exe",S(c,"exe")},{"job",Job(c)},{"guardian_pid",self.Id},{"guardian_created_ms",Created(self.Handle)},{"guardian_created_filetime",CreatedRaw(self.Handle).ToString()},{"assigned_before_resume",true}});
      if(ResumeThread(p.thread)==0xffffffff)throw new Win32Exception(Marshal.GetLastWin32Error());resumed=true;
      // Parent exit, broker death and PTY closure never substitute for job accounting.
      while(Active(job)!=0)Thread.Sleep(100);
      Receipt(c,"closed",new Dictionary<string,object>{{"active",0},{"root_pid",p.pid},{"basis","kernel job active count zero"}});
      return 0;
    } finally {
      // Failure before resume is cancellation of an inert suspended process,
      // never an implicit force escalation against an executing workload.
      if(!resumed && p.process!=IntPtr.Zero)Check(TerminateProcess(p.process,125));
      if(p.thread!=IntPtr.Zero)CloseHandle(p.thread);if(p.process!=IntPtr.Zero)CloseHandle(p.process);
      CloseHandle(job);
    }
  }
  public static int Main(string[] args) {
    try {
      if(args.Length!=2 || !(args[0]=="launch"||args[0]=="query"||args[0]=="graceful"||args[0]=="force"||args[0]=="recover-empty"))throw new Exception("fixed operation and config path required");
      var c=Read(Path.GetFullPath(args[1]));
      if(S(c,"schema")!="starq.windows.job/v1" || !System.Text.RegularExpressions.Regex.IsMatch(S(c,"instance"),"^[a-f0-9]{32}$") || S(c,"token").Length<32 || !Path.IsPathRooted(S(c,"directory")))throw new Exception("invalid containment descriptor");
      if(c.ContainsKey("env"))throw new Exception("descriptor must not carry an environment");
      if(args[0]=="launch")return Launch(c);
      var start=Verified(c,"started");if(S(start,"job")!=Job(c) || !(bool)start["assigned_before_resume"])throw new Exception("launch receipt mismatch");
      IntPtr job=OpenJobObject(args[0]=="force"?0x0cU:0x04U,false,Job(c));
      int openError=job==IntPtr.Zero?Marshal.GetLastWin32Error():0;
      if(job==IntPtr.Zero && openError!=2)throw new Win32Exception(openError);
      try {
        // Explicit recovery may reconcile a lost guardian receipt only when Windows no longer
        // has the uniquely named job object AND both original processes are gone/reused. A job
        // object remains alive while any member process exists, so absence proves the family is
        // empty; the authenticated started receipt binds the exact job, root and guardian.
        // This path writes evidence only; it never signals a process.
        if(args[0]=="recover-empty") {
          if(job!=IntPtr.Zero) throw new Exception("named job object still exists");
          if(openError!=2) throw new Win32Exception(openError);
          if(!GuardianGone(start) || !RootGone(start)) throw new Exception("job object absent but original guardian or root is still live");
          string recoverClosed=S(c,"directory")+"\\closed.json";
          if(!File.Exists(recoverClosed)) Receipt(c,"closed",new Dictionary<string,object>{{"active",0},{"root_pid",Convert.ToInt64(start["root_pid"])},{"basis","explicit recovery: named job absent and original root/guardian exited"}});
          Console.WriteLine(json.Serialize(Status(c,IntPtr.Zero,start)));
          return 0;
        }
        if(args[0]=="force" && job==IntPtr.Zero) {
          if(!GuardianGone(start) || !RootGone(start))throw new Exception("job object absent but original guardian or root is still live");
          string closedPath=S(c,"directory")+"\\closed.json";
          if(!File.Exists(closedPath))Receipt(c,"closed",new Dictionary<string,object>{{"active",0},{"root_pid",Convert.ToInt64(start["root_pid"])},{"basis","explicit recovery: named job absent and original root/guardian exited"}});
        }
        if(job!=IntPtr.Zero){SafeLimits(job);
          if(args[0]=="force")Check(TerminateJobObject(job,137));
          if(args[0]=="graceful" && Active(job)>0){
            uint root=Convert.ToUInt32(start["root_pid"]);IntPtr h=OpenProcess(0x1000,false,root);
            if(h==IntPtr.Zero)throw new Exception("root gone; graceful group identity unavailable; family remains owned");
            try {bool member;Check(IsProcessInJob(h,job,out member));if(!member||CreatedRaw(h)!=Convert.ToInt64(start["root_created_filetime"]))throw new Exception("root identity changed");
              if(GuardianGone(start))throw new Exception("guardian identity unavailable; console signal refused");
              IntPtr output=GetStdHandle(-11),error=GetStdHandle(-12);
              FreeConsole();Check(AttachConsole(Convert.ToUInt32(start["guardian_pid"])));
              Check(SetStdHandle(-11,output));Check(SetStdHandle(-12,error));
              if(GuardianGone(start))throw new Exception("guardian identity changed during console attachment");
              SetConsoleCtrlHandler(IntPtr.Zero,true);Check(GenerateConsoleCtrlEvent(1,root));
            }finally{CloseHandle(h);}
          }
        }
        Console.WriteLine(json.Serialize(Status(c,job,start)));return 0;
      }finally{if(job!=IntPtr.Zero)CloseHandle(job);}
    }catch(Exception e){Console.Error.WriteLine(json.Serialize(new {owned=false,closed=false,error=e.Message}));return 2;}
  }
}
