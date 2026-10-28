# Security policy

## Supported versions

This repository currently has no published release or production support policy. Security fixes are made to the current development branch where practical.

## Reporting a vulnerability

Do not open a public issue containing exploit details, credentials, personal information, or health data. Report concerns through GitHub's private vulnerability reporting/security advisory feature for this repository if it is enabled. Otherwise contact the repository owner privately through GitHub and request a secure reporting channel.

Include affected component/version, impact, and concise reproduction conditions. Do not send real ECG recordings or identifiable health data as a proof of concept.

## Security and privacy boundaries

The backend is a local, single-process development server. It stores recordings/results in process memory with lazy expiry, has no authentication or cross-user isolation, and is not designed for public exposure. The 25 MB upload limit and parser validation do not make it safe for untrusted production deployment. Do not submit identifiable patient recordings, secrets, or report PDFs to public issues or pull requests.

This project makes no HIPAA, GDPR, or other regulatory compliance claim.
