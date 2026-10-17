package com.fbi.plugins.reportbtn.docs.mail;

import jakarta.mail.Message;
import jakarta.mail.Session;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeBodyPart;
import jakarta.mail.internet.MimeMessage;
import jakarta.mail.internet.MimeMultipart;
import org.jsoup.Jsoup;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Date;
import java.util.List;
import java.util.Properties;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The message for a draft:
 *   mixed [ alternative [ text/plain, html (or related [ html, inline images ]) ], attachments… ]
 * The HTML gets its style sheet inlined (CssInliner) and pasted images (data: URLs)
 * become inline parts, which mail programs show where data: URLs are blocked.
 */
public final class MimeBuilder {

    private static final Pattern DATA_IMG = Pattern.compile(
        "src\\s*=\\s*([\"'])data:(image/[\\w.+-]+);base64,([A-Za-z0-9+/=\\s]+)\\1", Pattern.CASE_INSENSITIVE);

    private MimeBuilder() {
    }

    /** forDraft: for the user's own email program (no From, no automatic Bcc, no date). */
    public static MimeMessage build(Session session, EmailDraft d, MailSettings s, boolean forDraft) throws Exception {
        MimeMessage m = new MimeMessage(session);
        if (!forDraft && s != null && !MailSettings.blank(s.fromEmail)) {
            m.setFrom(new InternetAddress(s.fromEmail, MailSettings.blank(s.fromName) ? null : s.fromName, "UTF-8"));
        }
        m.setRecipients(Message.RecipientType.TO, addresses(d.to));
        m.setRecipients(Message.RecipientType.CC, addresses(d.cc));
        List<String> bcc = new ArrayList<>(d.bcc);
        if (!forDraft && s != null && s.bccSent && !MailSettings.blank(s.bccAddress)) {
            bcc.addAll(EmailDraft.split(s.bccAddress));
        }
        m.setRecipients(Message.RecipientType.BCC, addresses(bcc));
        m.setSubject(d.subject == null ? "" : d.subject, "UTF-8");
        if (!forDraft) {
            m.setSentDate(new Date());
        }

        List<MimeBodyPart> images = new ArrayList<>();
        String html = inlineImages(CssInliner.inline(d.html), images);
        MimeBodyPart htmlPart = new MimeBodyPart();
        htmlPart.setContent(html, "text/html; charset=UTF-8");
        MimeBodyPart textPart = new MimeBodyPart();
        textPart.setText(plainText(html), "UTF-8");

        MimeMultipart alternative = new MimeMultipart("alternative");
        alternative.addBodyPart(textPart);
        if (images.isEmpty()) {
            alternative.addBodyPart(htmlPart);
        } else {
            MimeMultipart related = new MimeMultipart("related");
            related.addBodyPart(htmlPart);
            for (MimeBodyPart img : images) {
                related.addBodyPart(img);
            }
            MimeBodyPart relatedPart = new MimeBodyPart();
            relatedPart.setContent(related);
            alternative.addBodyPart(relatedPart);
        }
        MimeMultipart mixed = new MimeMultipart("mixed");
        MimeBodyPart body = new MimeBodyPart();
        body.setContent(alternative);
        mixed.addBodyPart(body);
        for (File f : d.attachments) {
            MimeBodyPart a = new MimeBodyPart();
            a.attachFile(f);
            a.setFileName(f.getName());
            mixed.addBodyPart(a);
        }
        m.setContent(mixed);
        m.saveChanges();
        return m;
    }

    /**
     * A draft for the user's own email program: a .eml file that opens as an unsent
     * message. X-Unsent is the first line (new Outlook looks for it there) and the
     * message has a Message-ID (new Outlook won't save a draft without one).
     */
    public static void writeDraft(EmailDraft d, File out) throws Exception {
        MimeMessage m = build(Session.getInstance(new Properties()), d, null, true);
        try (OutputStream o = new FileOutputStream(out)) {
            o.write("X-Unsent: 1\r\n".getBytes(java.nio.charset.StandardCharsets.US_ASCII));
            m.writeTo(o);
        }
    }

    /** The text of an HTML body, with line breaks where its blocks end. */
    public static String plainText(String html) {
        String marked = html.replaceAll("(?i)<br\\s*/?>", "\n")
            .replaceAll("(?i)</(p|div|tr|li|h[1-6]|table|blockquote)>", "$0\n");
        StringBuilder out = new StringBuilder();
        for (String line : Jsoup.parse(marked).body().wholeText().replace("\r", "").split("\n", -1)) {
            out.append(line.trim().replaceAll("[ \\t\\xA0]{2,}", " ")).append('\n');
        }
        return out.toString().replaceAll("\n{3,}", "\n\n").trim();
    }

    /** Swaps data: images for cid: references, adding a part for each. */
    static String inlineImages(String html, List<MimeBodyPart> parts) throws Exception {
        Matcher mt = DATA_IMG.matcher(html);
        StringBuffer out = new StringBuffer();
        int n = 0;
        while (mt.find()) {
            String cid = "img" + (++n) + "." + System.nanoTime() + "@fishbowl";
            MimeBodyPart p = new MimeBodyPart();
            byte[] bytes = Base64.getMimeDecoder().decode(mt.group(3));
            p.setContent(bytes, mt.group(2));
            p.setContentID("<" + cid + ">");
            p.setDisposition(MimeBodyPart.INLINE);
            parts.add(p);
            mt.appendReplacement(out, Matcher.quoteReplacement("src=" + mt.group(1) + "cid:" + cid + mt.group(1)));
        }
        mt.appendTail(out);
        return out.toString();
    }

    private static InternetAddress[] addresses(List<String> list) throws Exception {
        List<InternetAddress> out = new ArrayList<>();
        for (String a : list) {
            for (InternetAddress ia : InternetAddress.parse(a, false)) {
                out.add(ia);
            }
        }
        return out.toArray(new InternetAddress[0]);
    }
}
