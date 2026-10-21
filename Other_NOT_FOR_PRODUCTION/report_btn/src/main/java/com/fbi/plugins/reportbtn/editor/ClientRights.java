package com.fbi.plugins.reportbtn.editor;

import com.evnt.client.common.EVEManagerUtil;
import com.evnt.common.AccessRights;
import com.evnt.eve.security.UserCredentials;
import com.fbi.plugins.reportbtn.WorkspaceHost;
import com.fbi.sdk.constants.bi.AccessLevelConst;

/**
 * AccessPolicy.Rights for the signed-in user, read from the client the way the
 * native modules read it: AccessRights.X.hasAccess() for the module rights, and
 * UserCredentials.getBiReportAccess(id) for a report (what the BI Report module's
 * Parameters button checks). The per-report map is filled at login; when it is
 * missing the stored bireportaccess rows decide.
 */
final class ClientRights {

    private ClientRights() {
    }

    static AccessPolicy.Rights current(WorkspaceHost host, ScriptService service) {
        int userId = safeUserId(host);
        UserCredentials creds = credentials();
        return new AccessPolicy.Rights(isAdmin(host),
            has(AccessRights.BI_SCRIPT_EDIT), has(AccessRights.BI_REPORT_EDIT), has(AccessRights.BI_REPORT_DELETE),
            has(AccessRights.BI_SCRIPT_DELETE), reportId -> level(creds, service, reportId, userId));
    }

    /** True when the user may edit with the editor at all (for New Page and FB_WORKSPACE.edit). */
    /** Creating, renaming and deleting Apps panel folders: Reports-Company Edit, as Fishbowl's own report tree. */
    static boolean mayManageFolders(WorkspaceHost host) {
        return isAdmin(host) || has(AccessRights.REPORTS_COMPANY_EDIT);
    }

    static boolean mayEdit(WorkspaceHost host) {
        return isAdmin(host) || has(AccessRights.BI_SCRIPT_EDIT);
    }

    /** True when the user may see a page's code (the BI Editor module needs BI Editor-View). */
    static boolean mayView(WorkspaceHost host) {
        return isAdmin(host) || has(AccessRights.BI_SCRIPT_VIEW) || has(AccessRights.BI_SCRIPT_EDIT);
    }

    /** User id 1, or the user named admin: what UserCredentials and the catalog treat as admin. */
    static boolean isAdmin(WorkspaceHost host) {
        if (safeUserId(host) == 1) {
            return true;
        }
        try {
            return "admin".equalsIgnoreCase(host.userName());
        } catch (RuntimeException e) {
            return false;
        }
    }

    private static AccessLevelConst level(UserCredentials creds, ScriptService service, int reportId, int userId) {
        if (creds != null) {
            try {
                AccessLevelConst l = creds.getBiReportAccess(reportId);
                if (l != null && l != AccessLevelConst.NONE) {
                    return l;
                }
            } catch (RuntimeException ignored) {
                // fall back to the stored rows
            }
        }
        String stored = service.storedLevel(reportId, userId);
        if (stored == null) {
            return AccessLevelConst.NONE;
        }
        String s = stored.trim();
        for (AccessLevelConst c : AccessLevelConst.values()) {
            if (c.getName().equalsIgnoreCase(s) || c.name().equalsIgnoreCase(s.replace(' ', '_'))) {
                return c;
            }
        }
        return s.toLowerCase().contains("edit") ? AccessPolicy.EDIT_LEVEL : AccessLevelConst.VIEW;
    }

    private static boolean has(AccessRights right) {
        try {
            return right.hasAccess();
        } catch (RuntimeException e) {
            return false;
        }
    }

    private static UserCredentials credentials() {
        try {
            return EVEManagerUtil.getUserCredentials();
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static int safeUserId(WorkspaceHost host) {
        try {
            return host.userId();
        } catch (RuntimeException e) {
            return 0;
        }
    }
}
