# Automated Submission of Applications for Open Job Listings on LinkedIn

1. Clone the project to your device.
2. Download and install the latest version of Google Chrome.
3. Make sure you have the latest version of node.js installed.
4. Install the necessary packages using the command `npm install`.
5. Create a file named `.env` in the project and add the variables `USER_NAME` and `USER_PASS` for storing authentication data.
   Example:
```
USER_NAME=helloImUsername
USER_PASS=helloImPassword
```
6. Start the script with the command `node index.js`.

Custom fields in the job application form are not filled out automatically. The `applyingTimeout` property in the `LinkedinJobSearcher` class specifies the time allotted for filling out the custom fields of the form.

