# GitHub Discussions Configuration Proposal

This document outlines the proposed configuration for enabling GitHub Discussions on the Sorokeep repository. Since enabling Discussions requires repository admin privileges, this proposal provides the exact category structure and welcome post text for a maintainer to apply.

## 1. Enable GitHub Discussions
1. Navigate to the repository **Settings** > **General**.
2. Scroll down to the **Features** section.
3. Check the box next to **Discussions**.
4. Click **Set up discussions** if prompted.

## 2. Configure Categories
Set up the following categories to match the existing references in `.github/ISSUE_TEMPLATE/config.yml` and `CONTRIBUTING.md`. You can configure these by clicking the "Edit categories" button (pencil icon) in the Discussions tab.

### Required Categories:

| Category Name | Format | Description |
| :--- | :--- | :--- |
| **Q&A** | Question / Answer | Ask questions, get help, and help other developers using Sorokeep. |
| **Ideas** | Open-ended discussion | Share ideas for new features, integrations, or improvements before opening a formal issue. |
| **Show and Tell** | Open-ended discussion | Show off what you've built with Sorokeep or how you're using it in your infrastructure! |
| **Announcements** | Announcement | Updates, releases, and important news from the Sorokeep maintainers. (Restrict to repository maintainers only) |

*(Note: You can delete the default "General" category if desired, or keep it for miscellaneous topics).*

## 3. Pinned Welcome Post
Create a new discussion in the **Announcements** category, pin it, and use the following text:

---
**Title:** Welcome to Sorokeep Discussions! 👋 (Please read first)

**Body:**

Welcome to the Sorokeep community! We've opened up GitHub Discussions as a dedicated space for our community to connect, ask questions, and share ideas without cluttering the issue tracker.

### Discussions vs. Issues: Where should I post?

To keep our repository organized and ensure you get the best response, please follow these guidelines:

**✅ Use GitHub Discussions for:**
- **Q&A:** You need help using the CLI, writing a guard policy, or configuring a webhook.
- **Ideas & Brainstorming:** You have a concept for a new feature (like a new alert channel or dashboard) but it needs refinement before becoming a concrete task.
- **Show and Tell:** You want to share an awesome Soroban project you're monitoring with Sorokeep!
- **General Chat:** You want to connect with other Sorokeep users.

**✅ Use GitHub Issues for:**
- **Bug Reports:** You found a reproducible bug or unexpected behavior in the daemon, CLI, or API.
- **Actionable Feature Requests:** You have a specific, well-defined feature request ready for implementation.
- **Code Tasks:** Tasks actively being worked on by contributors.

For more detailed information on how to contribute to Sorokeep, please check out our [CONTRIBUTING.md](../blob/main/CONTRIBUTING.md).

We're excited to hear from you! Jump into the **Q&A** or **Show and Tell** categories to say hello.
---

## 4. Verification (Acceptance Criteria)
Once the above is complete:
1. Verify that the GitHub Discussions tab is visible.
2. Verify the four categories (Q&A, Ideas, Show and Tell, Announcements) are correctly configured.
3. Verify that the link in `.github/ISSUE_TEMPLATE/config.yml` (if it links to `/discussions`) now resolves correctly to the new Discussions tab instead of a 404 page.
