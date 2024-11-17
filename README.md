# Automated Submission of Applications for Open Job Listings on LinkedIn

1. Clone the project to your device.
2. Download and install the latest version of Google Chrome.
3. Make sure you have the latest version of node.js installed.
4. Install the necessary packages using the command `npm install`.
5. Download and install MongoDB Compass from the official website [https://www.mongodb.com/products/tools/compass](https://www.mongodb.com/products/tools/compass).
6. Create a database named `vacancies` and a tables within it called `submitted_applications`, `potential_jobs`, `sent_messages` and `unsent_messages`.
7. Create a file named `.env` in the project and add the variables `USER_NAME`, `USER_PASS` (for linkedin auth) and `DB_URL` for storing authentication data.
   Example:
```
USER_NAME=linkedinUsername
USER_PASS=linkedinassword
DB_URL=linkToYourMongoDB
```
8. Start the script with the command `node index.js`.
9. In the `myKeyWords.js` file, update the `permit` and `subPermit` variables to evaluate the job description.
10. In the `searchUrls.js` file, update the `geoIds` and `keywords` variables to generate job search links.
11. Update `tabooCompanies.js` or `tabooStates.js` to exclude companies or countries from search

Custom fields in the job application form are not filled out automatically. The `applyingTimeout` property in the `LinkedinJobSearcher` class specifies the time allotted for filling out the custom fields of the form.

