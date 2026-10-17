package com.fbi.plugins.reportbtn.docs.mail;

import com.evnt.client.common.ClientProperties;
import com.fbi.sdk.constants.SystemPropertyConst;

/**
 * The email settings the client's own email window uses: this PC's client.properties
 * value when it has one, else the company's (Settings › Email). Which of the two
 * the stock window prefers when both are set is an open check (spike S7).
 */
public final class MailSettings {

    /** How the stock window sends: through the Google or Microsoft account it was linked to, else SMTP. */
    public enum Route { SMTP, GOOGLE, MICROSOFT }

    public final String server, port, user, passwordEncrypted, fromName, fromEmail, secure, bccAddress;
    public final boolean bccSent;
    public final String googleAccess, googleRefresh, microsoftAccess, microsoftRefresh;

    private MailSettings() {
        server = get(SystemPropertyConst.EMAIL_SMTP_SERVER);
        port = get(SystemPropertyConst.EMAIL_SMTP_PORT);
        user = get(SystemPropertyConst.EMAIL_SMTP_USER);
        passwordEncrypted = get(SystemPropertyConst.EMAIL_SMTP_PW);
        fromName = get(SystemPropertyConst.EMAIL_FROM_NAME);
        fromEmail = get(SystemPropertyConst.EMAIL_FROM_EMAIL);
        secure = get(SystemPropertyConst.EMAIL_SECURE);
        bccAddress = get(SystemPropertyConst.EMAIL_BCC_ADDRESS);
        bccSent = Boolean.parseBoolean(get(SystemPropertyConst.EMAIL_BCC_SENT));
        googleAccess = get(SystemPropertyConst.GOOGLE_ACCESS_TOKEN);
        googleRefresh = get(SystemPropertyConst.GOOGLE_REFRESH_TOKEN);
        microsoftAccess = get(SystemPropertyConst.MICROSOFT_ACCESS_TOKEN);
        microsoftRefresh = get(SystemPropertyConst.MICROSOFT_REFRESH_TOKEN);
    }

    public static MailSettings current() {
        return new MailSettings();
    }

    public Route route() {
        if (!blank(googleRefresh)) {
            return Route.GOOGLE;
        }
        if (!blank(microsoftRefresh)) {
            return Route.MICROSOFT;
        }
        return Route.SMTP;
    }

    /** The template file path for a kind of email (SO, PO, SHIP, GENERIC), or "". */
    public static String templatePath(String kind) {
        switch (kind) {
            case "SO": return get(SystemPropertyConst.EMAIL_SO_EMAIL);
            case "PO": return get(SystemPropertyConst.EMAIL_PO_EMAIL);
            case "SHIP": return get(SystemPropertyConst.EMAIL_SHIP_EMAIL);
            default: return get(SystemPropertyConst.EMAIL_GENERIC_EMAIL);
        }
    }

    public int portOr(int dflt) {
        try {
            return Integer.parseInt(port.trim());
        } catch (RuntimeException e) {
            return dflt;
        }
    }

    static String get(SystemPropertyConst p) {
        String v = null;
        try {
            v = ClientProperties.getProperty(p.getName(), "");
        } catch (RuntimeException | LinkageError ignored) {
            // outside the client
        }
        if (blank(v)) {
            try {
                v = p.getString();
            } catch (RuntimeException | LinkageError ignored) {
                v = null;
            }
        }
        return v == null ? "" : v.trim();
    }

    static boolean blank(String s) {
        return s == null || s.trim().isEmpty();
    }
}
