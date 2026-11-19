---
title: Embedding the booking widget on your website
category: Booking page
---

# Embedding the booking widget on your website

The widget puts your booking page inside your own website, so clients never leave it.

## Get the snippet

Go to **Settings → Booking page → Embed** and copy the snippet. It looks like this:

```html
<div id="slotwise-booking"></div>
<script src="https://widget.slotwise.app/v2/embed.js" data-studio="your-studio-id" async></script>
```

Paste it where you want the widget to appear.

## Website builders

- **WordPress**: add a _Custom HTML_ block and paste the snippet.
- **Squarespace**: add a _Code_ block. Squarespace only runs scripts in Code blocks on Business plans and
  above. On the Personal plan, use a button that links to your booking page instead.
- **Wix**: add _Embed Code → Embed HTML_ and paste the snippet. Set the element to at least 700px high.
- **Webflow**: use an _Embed_ element.

## The widget doesn't show up

1. **Check the studio id.** `data-studio` must match the id shown on the Embed screen exactly.
2. **Check your plan with the website builder.** See the Squarespace note above.
3. **Content Security Policy.** If your site sets a CSP header, allow `https://widget.slotwise.app` in
   `script-src` and `frame-src`.
4. **Ad blockers and privacy extensions** sometimes block third-party widgets. Test in a private window
   with extensions off.
5. **Publish the page.** Some builders don't run scripts in their editor preview.

If none of these help, send us the page URL and we will look.
