package com.fbi.plugins.reportbtn.docs.mail;

import com.evnt.client.EmailSettingsPanel;
import com.evnt.client.GoogleConnectionDriver;
import com.evnt.client.MicrosoftConnectionDriver;
import com.evnt.security.Encryptor;
import jakarta.mail.Session;
import jakarta.mail.internet.MimeMessage;

/**
 * Sends a draft the way the client's own email window does, through the same
 * public helpers: SMTP (EmailSettingsPanel.createEmailSession / sendEmail, TLS or
 * SSL from SecureEmail, the stored password decrypted), or the Google or Microsoft
 * account the settings are linked to. An OAuth send that fails is retried once with
 * a refreshed token; the refreshed token isn't stored (the stock window refreshes it
 * again next time).
 */
public final class MailSender {

    private interface Send {
        void with(String token) throws Exception;
    }

    private interface Refresh {
        String token() throws Exception;
    }

    private MailSender() {
    }

    /** Sends, or throws with the server's own words. Off the event thread. */
    public static void send(EmailDraft d) throws Exception {
        if (d.to.isEmpty() && d.cc.isEmpty() && d.bcc.isEmpty()) {
            throw new Exception("Add at least one recipient.");
        }
        MailSettings s = MailSettings.current();
        switch (s.route()) {
            case GOOGLE: {
                Session session = EmailSettingsPanel.createOauthSession(s.portOr(587));
                MimeMessage m = MimeBuilder.build(session, d, s, false);
                oauth("Google", s.googleAccess, t -> GoogleConnectionDriver.sendGmail(t, s.user, m),
                    () -> GoogleConnectionDriver.refreshAccessToken(s.googleRefresh));
                break;
            }
            case MICROSOFT: {
                Session session = EmailSettingsPanel.createOauthSession(s.portOr(587));
                MimeMessage m = MimeBuilder.build(session, d, s, false);
                oauth("Microsoft", s.microsoftAccess, t -> MicrosoftConnectionDriver.sendEmail(t, s.user, m),
                    () -> MicrosoftConnectionDriver.refreshAccessToken(s.microsoftRefresh).getAccessToken());
                break;
            }
            default: {
                if (MailSettings.blank(s.server)) {
                    throw new Exception("No email server is set up (Tools › Options › Email, or Settings › Email).");
                }
                Session session = EmailSettingsPanel.createEmailSession(s.portOr(25),
                    "SecureTLS".equalsIgnoreCase(s.secure), "SecureSSL".equalsIgnoreCase(s.secure));
                MimeMessage m = MimeBuilder.build(session, d, s, false);
                EmailSettingsPanel.sendEmail(session, m, s.server, s.user, decrypt(s.passwordEncrypted));
            }
        }
    }

    private static void oauth(String who, String stored, Send send, Refresh refresh) throws Exception {
        Exception first = null;
        if (!MailSettings.blank(stored)) {
            try {
                send.with(stored);
                return;
            } catch (Exception e) {
                first = e;
            }
        }
        String fresh;
        try {
            fresh = refresh.token();
        } catch (Exception e) {
            throw new Exception("Sending through the linked " + who + " account failed"
                + (first != null ? " (" + first.getMessage() + ")" : "") + ", and its sign-in couldn't be renewed: " + e.getMessage(), e);
        }
        send.with(fresh);
    }

    private static String decrypt(String encrypted) {
        if (MailSettings.blank(encrypted)) {
            return "";
        }
        try {
            String p = Encryptor.getInstance().decrypt(encrypted);
            return p == null ? "" : p;
        } catch (RuntimeException e) {
            return encrypted;   // stored plain
        }
    }
}
