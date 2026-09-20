using System.Runtime.InteropServices;
using System.Text;

namespace FbApiTool;

/// <summary>
/// Passwords, kept in the Windows Credential Manager.
///
/// Not in this tool's own settings file, and not encrypted by hand. The OS
/// vault is per-user, protected by the logon session, visible and revocable in
/// Control Panel ▸ Credential Manager, and — the practical part — it is what
/// password managers already fill. This tool never sees a stored password
/// except at the moment it uses one.
///
/// Nothing here is required: the tool works exactly as before with nothing
/// stored, and every method fails quietly rather than blocking a sign-in.
/// </summary>
public static class CredentialStore
{
    private const int CRED_TYPE_GENERIC = 1;
    private const int CRED_PERSIST_LOCAL_MACHINE = 2;

    /// <summary>
    /// The vault key. Namespaced so these are recognisable in Credential
    /// Manager and cannot collide with anything else the user has saved.
    /// </summary>
    public static string TargetFor(string serverUrl, string username) =>
        "FbApiTool:" + (serverUrl ?? "").TrimEnd('/') + ":" + (username ?? "");

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct CREDENTIAL
    {
        public int Flags;
        public int Type;
        public nint TargetName;
        public nint Comment;
        public long LastWritten;
        public int CredentialBlobSize;
        public nint CredentialBlob;
        public int Persist;
        public int AttributeCount;
        public nint Attributes;
        public nint TargetAlias;
        public nint UserName;
    }

    // DllImport rather than the source-generated LibraryImport: that one
    // requires AllowUnsafeBlocks across the whole project, which is a large
    // relaxation to buy four P/Invokes.
    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CredRead(string target, int type, int reservedFlag, out nint credentialPtr);

    [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CredWrite(ref CREDENTIAL credential, int flags);

    [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CredDelete(string target, int type, int flags);

    [DllImport("advapi32.dll", EntryPoint = "CredFree")]
    private static extern void CredFree(nint buffer);

    /// <summary>Keep a password. Returns false if the vault refused it.</summary>
    public static bool Save(string target, string username, string password)
    {
        if (string.IsNullOrEmpty(target)) return false;

        var blob = Encoding.Unicode.GetBytes(password ?? "");
        var blobPtr = Marshal.AllocHGlobal(blob.Length);
        var targetPtr = Marshal.StringToCoTaskMemUni(target);
        var userPtr = Marshal.StringToCoTaskMemUni(username ?? "");

        try
        {
            Marshal.Copy(blob, 0, blobPtr, blob.Length);

            var cred = new CREDENTIAL
            {
                Type = CRED_TYPE_GENERIC,
                TargetName = targetPtr,
                CredentialBlobSize = blob.Length,
                CredentialBlob = blobPtr,
                Persist = CRED_PERSIST_LOCAL_MACHINE,
                UserName = userPtr,
            };
            return CredWrite(ref cred, 0);
        }
        catch { return false; }
        finally
        {
            // The password must not outlive this call in our own memory.
            Array.Clear(blob);
            Marshal.FreeHGlobal(blobPtr);
            Marshal.FreeCoTaskMem(targetPtr);
            Marshal.FreeCoTaskMem(userPtr);
        }
    }

    /// <summary>The stored password, or null if there is none.</summary>
    public static string? Load(string target)
    {
        if (string.IsNullOrEmpty(target)) return null;

        nint ptr = 0;
        try
        {
            if (!CredRead(target, CRED_TYPE_GENERIC, 0, out ptr)) return null;

            var cred = Marshal.PtrToStructure<CREDENTIAL>(ptr);
            if (cred.CredentialBlobSize == 0 || cred.CredentialBlob == 0) return null;

            return Marshal.PtrToStringUni(cred.CredentialBlob, cred.CredentialBlobSize / 2);
        }
        catch { return null; }
        finally { if (ptr != 0) CredFree(ptr); }
    }

    public static bool Exists(string target) => Load(target) is not null;

    public static bool Delete(string target)
    {
        if (string.IsNullOrEmpty(target)) return false;
        try { return CredDelete(target, CRED_TYPE_GENERIC, 0); }
        catch { return false; }
    }
}
