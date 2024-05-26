require("dotenv").config();
const puppeteer = require("puppeteer");
const myKeyWords = require("./myKeyWords.js");
const stopWordsInTitle = require("./stopWordsInTitle.js");
// const allowedStates = require("./allowedStates.js");
const { DB, CLIENT } = require("./db-client.js");

class LinkedinJobSearcher {
  constructor() {
    this.browser = null;
    this.page = null;
    this.table = null;
    // Links to go to the search page
    this.searchUrls = [
      "https://www.linkedin.com/jobs/collections/easy-apply/?currentJobId=3828084624&discover=recommended&discoveryOrigin=JOBS_HOME_JYMBII",
      "https://www.linkedin.com/jobs/collections/recommended/?currentJobId=3918406757&discover=recommended&discoveryOrigin=JOBS_HOME_JYMBII",
      "https://www.linkedin.com/jobs/collections/top-applicant/?currentJobId=3921039339",
      "https://www.linkedin.com/jobs/search/?currentJobId=3917578165&distance=25&f_AL=true&f_JT=F%2CP%2CC&f_WT=2&geoId=105072130&keywords=Frontend%20Developer&origin=JOB_SEARCH_PAGE_JOB_FILTER&refresh=true&sortBy=DD",
      "https://www.linkedin.com/jobs/search/?currentJobId=3935268194&f_AL=true&f_JT=F%2CP%2CC&f_WT=2&geoId=105072130&keywords=Full-stack%20Developer&location=Poland&origin=JOB_SEARCH_PAGE_SEARCH_BUTTON&refresh=true&sortBy=DD",
      "https://www.linkedin.com/jobs/search/?currentJobId=3917543403&f_AL=true&f_JT=F%2CP%2CC&f_WT=2&geoId=105072130&keywords=React%20Developer&location=Poland&origin=JOB_SEARCH_PAGE_KEYWORD_AUTOCOMPLETE&refresh=true&sortBy=DD",
      "https://www.linkedin.com/jobs/search/?currentJobId=3917578165&f_AL=true&f_JT=F%2CP%2CC&f_WT=2&geoId=105072130&keywords=Javascript%20Developer&location=Poland&origin=JOB_SEARCH_PAGE_SEARCH_BUTTON&refresh=true&sortBy=DD",
      "https://www.linkedin.com/jobs/search/?currentJobId=3919738664&f_AL=true&f_JT=F%2CP%2CC&f_WT=2&geoId=105072130&keywords=Javascript&location=Poland&origin=JOB_SEARCH_PAGE_SEARCH_BUTTON&refresh=true&sortBy=DD",
      "https://www.linkedin.com/jobs/search/?currentJobId=3918221427&f_AL=true&f_JT=F%2CP%2CC&f_WT=2&geoId=105072130&keywords=Frontend&location=Poland&origin=JOB_SEARCH_PAGE_SEARCH_BUTTON&refresh=true&sortBy=DD",
      "https://www.linkedin.com/jobs/search/?currentJobId=3885127146&f_AL=true&f_WT=2&geoId=92000000&keywords=Frontend%20Developer&location=Worldwide&origin=JOB_SEARCH_PAGE_JOB_FILTER&refresh=true&sortBy=DD",
      "https://www.linkedin.com/jobs/search/?currentJobId=3930467690&f_AL=true&f_WT=2&geoId=92000000&keywords=Front-end%20Developer&location=Worldwide&origin=JOB_SEARCH_PAGE_SEARCH_BUTTON&refresh=true&sortBy=DD",
      "https://www.linkedin.com/jobs/search/?currentJobId=3930467690&f_AL=true&f_WT=2&geoId=92000000&keywords=Full-stack%20Developer&location=Worldwide&origin=JOB_SEARCH_PAGE_SEARCH_BUTTON&refresh=true&sortBy=DD",
      "https://www.linkedin.com/jobs/search/?currentJobId=3932512710&f_AL=true&f_WT=2&geoId=92000000&keywords=React%20Developer&location=Worldwide&origin=JOB_SEARCH_PAGE_SEARCH_BUTTON&refresh=true&sortBy=DD",
      "https://www.linkedin.com/jobs/search/?currentJobId=3932510776&f_AL=true&f_WT=2&geoId=92000000&keywords=Javascript%20Developer&location=Worldwide&origin=JOB_SEARCH_PAGE_SEARCH_BUTTON&refresh=true&sortBy=DD",
      "https://www.linkedin.com/jobs/search/?currentJobId=3935425789&f_AL=true&f_WT=2&geoId=92000000&keywords=Frontend&location=Worldwide&origin=JOB_SEARCH_PAGE_SEARCH_BUTTON&refresh=true&sortBy=DD",
      "https://www.linkedin.com/jobs/search/?currentJobId=3935425789&f_AL=true&f_WT=2&geoId=92000000&keywords=Javascript&location=Worldwide&origin=JOB_SEARCH_PAGE_SEARCH_BUTTON&refresh=true&sortBy=DD",
    ];
    // Time to fill out the form
    this.applyingTimeout = 10_000;
    this.emptyFieldsLimit = 0;
    this.headless = true;
    this.screenshotCounter = 0;
  }

  async init() {
    this.#progress(`Ready Linkedin.com`);
    await this.#startDB();
    this.browser = await puppeteer.launch({ headless: this.headless });
    this.page = (await this.browser.pages())[0];
    await this.page.setViewport({ width: 1000, height: 650 });
    await this.#run();
  }

  async #startDB() {
    try {
      await CLIENT.connect();
      this.table = DB.collection("submitted_applications");
    } catch (err) {
      console.log("Error connect", err);
    }
  }

  async #run() {
    await this.#login();
    await this.#mapSearchUrls();
    await this.browser.close();
  }

  async #login() {
    await this.page.goto(
      "https://www.linkedin.com/login/uk?fromSignIn=true&trk=guest_homepage-basic_nav-header-signin"
    );
    await this.page.type(".login__form input#username", process.env.USER_NAME);
    await this.page.type(".login__form input#password", process.env.USER_PASS);
    await this.#onClick(
      `.login__form .btn__primary--large.from__button--floating`
    );
    await this.page.waitForNavigation({ waitUntil: "load" });
  }

  async #mapSearchUrls() {
    for (let i = 0; i < this.searchUrls.length; i++) {
      await this.#visitSearchPage(this.searchUrls[i]);
      await this.#scrollJobsList();
      await this.#findingSulitableVacancies();
    }
  }

  #progress(string) {
    process.stdout.clearLine();
    process.stdout.cursorTo(0);
    process.stdout.write(string);
  }

  async #onClick(selector) {
    try {
      await this.page.waitForSelector(selector);
      await this.page.click(selector);
    } catch (error) {
      this.page.screenshot({
        path: `screenshots-linkedin/onclick-error-${this.screenshotCounter}.png`,
      });
      console.log(
        `Selector "${selector}" not found (${
          this.screenshotCounter
        }) ${this.page.url()}`
      );
      this.screenshotCounter = this.screenshotCounter + 1;
    }
  }

  async #closeChat() {
    await this.#onClick(
      `.msg-overlay-list-bubble [data-test-icon="chevron-down-small"]`
    );
  }

  async #visitSearchPage(searchUrl) {
    await this.page.goto(searchUrl);
  }

  async #scrollJobsList() {
    await this.page.waitForSelector(`.jobs-search-results-list`);
    await this.page.evaluate(async () => {
      const element = document.querySelector(".jobs-search-results-list");
      const countOfScroll = Math.ceil(element.scrollHeight / 20);

      if (element) {
        for (let i = 0; i < countOfScroll; i++) {
          element.scrollBy(0, 20);
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    const unloadedItem = await this.page.$(
      ".jobs-search-results__job-card-search--generic-occludable-area"
    );

    if (unloadedItem) {
      await this.page.evaluate(async () => {
        const element = document.querySelector(".jobs-search-results-list");
        if (element) {
          element.scrollTo(0, 0);
        }
      });
      return await this.#scrollJobsList();
    } else {
      return;
    }
  }

  async #findingSulitableVacancies() {
    // List of loaded vacancies
    const jobItems = await this.page.$$(
      ".scaffold-layout__list-container .ember-view.jobs-search-results__list-item:not(.jobs-search-results__job-card-search--generic-occludable-area)"
    );

    // Iterating through vacancies
    for (const job of jobItems) {
      // Skip if it's not a simple application submission
      const isEasyApply = await job.$$eval(
        `.job-card-container__apply-method`,
        (childs) => childs.length > 0
      );
      if (!isEasyApply) {
        continue;
      }
      // Skip if keywords are not found in the title
      const title = await this.page.evaluate(
        (e) => e.querySelector(".job-card-container__link strong").textContent,
        job
      );
      this.#progress(`${this.page.url()}`);
      const keyWordIncludes = myKeyWords.some((r) =>
        title.toLowerCase().includes(r.toLowerCase())
      );
      if (!keyWordIncludes) {
        continue;
      }

      const stopWordIncludes = stopWordsInTitle.some((r) =>
        title.toLowerCase().includes(r.toLowerCase())
      );
      if (stopWordIncludes) {
        continue;
      }

      let description = "";

      try {
        description = await this.page.evaluate(
          (e) => e.textContent.replace("\n", "").trim(),
          await this.page.$(
            ".job-details-jobs-unified-top-card__tertiary-description"
          )
        );
      } catch (error) {
        this.page.screenshot({
          path: `screenshots-linkedin/error-description-textContent.png`,
        });
        console.log(`Error on page ${this.page.url()}`);
      }
      // const allowedStatesIncludes = allowedStates.some((r) =>
      //   description.toLowerCase().includes(r.toLowerCase())
      // );
      // if (!allowedStatesIncludes) {
      //   continue;
      // }

      const successModal = await this.page.$(
        ".artdeco-modal.artdeco-modal--layer-default h2#post-apply-modal"
      );
      if (successModal) {
        await this.#onClick(
          `.artdeco-modal.artdeco-modal--layer-default .ember-view.artdeco-modal__dismiss`
        );
      }
      // Click on the vacancy
      try {
        await job.click();
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        // console.log(`Click error to job "${this.page.url()}"`);
        // this.page.screenshot({ path: `screenshots-linkedin/job-click-error.png` });
        continue;
      }
      // Wait for it to load
      await this.page.waitForSelector(".jobs-details__main-content");
      // Check error message
      const applyBtnError = await this.page.$(
        ".artdeco-inline-feedback--error"
      );
      if (applyBtnError) {
        const isFinalError = await this.page.evaluate(
          (e) =>
            e
              .querySelector(".artdeco-inline-feedback__message")
              .textContent.replace("\n", "")
              .trim(),
          applyBtnError
        );
        if (isFinalError) {
          await this.browser.close();
        }
        continue;
      }
      // Skip if there is no button for simple submission in the description
      const applyBtn = await this.page.$(
        ".jobs-details__main-content .relative .jobs-apply-button"
      );
      if (!applyBtn) {
        continue;
      }
      // Set job link
      let jobLink = "";
      try {
        jobLink = await this.page.evaluate(
          (e) => e.querySelector(".job-card-container__link").href,
          job
        );
      } catch (error) {
        console.error(`Cannot to find jobLink`);
      }
      // Set company link
      let companyLink = "";
      try {
        companyLink = await this.page.evaluate(
          (e) => e.href,
          await this.page.$(
            ".job-details-jobs-unified-top-card__company-name .app-aware-link"
          )
        );
      } catch (error) {
        console.error(`Cannot to find jobLink`);
      }

      await applyBtn.click();

      // Go through the pre-filled form as much as possible
      const modal = ".jobs-easy-apply-modal";
      try {
        await this.page.waitForSelector(`${modal} .jobs-easy-apply-content`, {
          visible: true,
        });
      } catch (error) {
        const modalSelector = await this.page.$(
          ".artdeco-modal.artdeco-modal--layer-default"
        );
        if (modalSelector) {
          await this.#onClick(
            `.artdeco-modal.artdeco-modal--layer-default .jobs-s-apply .jobs-apply-button.artdeco-button.artdeco-button--primary`
          );
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await this.#nextFromStep();

      try {
        await this.page.waitForSelector(
          `.artdeco-modal.artdeco-modal--layer-default h2#post-apply-modal`,
          {
            visible: true,
            timeout: 2000,
          }
        );
      } catch (error) {
        // If the form is not filled within the specified time, try to close it
        try {
          await this.#onClick(
            `.artdeco-modal.artdeco-modal--layer-default .ember-view.artdeco-modal__dismiss`
          );
          await new Promise((resolve) => setTimeout(resolve, 500));
          await this.#onClick(
            `.artdeco-button--secondary.artdeco-modal__confirm-dialog-btn`
          );
        } catch (error) {
          console.error("Error on close modal");
        }
        continue;
      }

      // Get the company name
      const companySelector = await this.page.$(
        ".job-details-jobs-unified-top-card__container--two-pane .job-details-jobs-unified-top-card__company-name"
      );
      let companyName = null;
      // Sometimes it might not be possible to find the company name
      // then use the description instead of the company
      if (companySelector) {
        companyName = await this.page.evaluate(
          (e) => e.textContent.replace("\n", "").trim(),
          companySelector
        );
      } else {
        companyName = description;
      }
      // Record the vacancy in the db table
      this.table.insertOne({
        title,
        companyName,
        description,
        jobLink,
        companyLink,
        date: new Date().toISOString(),
      });

      // Close the modal
      await this.#onClick(
        `.artdeco-modal.artdeco-modal--layer-default .ember-view.artdeco-modal__dismiss`
      );
    }

    await this.#paginationEnds();
  }

  async #nextFromStep() {
    const primaryButtonSelector = `.jobs-easy-apply-modal .jobs-easy-apply-content footer button.artdeco-button--primary`;
    const primaryButton = await this.page.$(primaryButtonSelector);

    if (!primaryButton) {
      return;
    } else {
      await this.#onClick(primaryButtonSelector);
    }

    const vmlPrim = (await this.page.$$(`.artdeco-inline-feedback__message`))
      .length;

    if (vmlPrim > this.emptyFieldsLimit) {
      return;
    }

    if (vmlPrim) {
      await this.#signal();
      // Expect the form to be filled within applyingTimeout
      await new Promise((resolve) =>
        setTimeout(resolve, this.applyingTimeout * vmlPrim)
      );
      await this.#onClick(primaryButtonSelector);
    }

    const validationMessage = await this.page.$(
      `.artdeco-inline-feedback__message`
    );
    const successModal = await this.page.$(
      ".artdeco-modal.artdeco-modal--layer-default h2#post-apply-modal"
    );

    if (validationMessage || successModal) {
      return;
    } else {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return await this.#nextFromStep();
    }
  }

  async #paginationEnds() {
    const nextPage = await this.page.$(
      `.artdeco-pagination__indicator.selected + .artdeco-pagination__indicator`
    );

    if (nextPage) {
      await nextPage.click();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await this.#scrollJobsList();
      await this.#findingSulitableVacancies();
    }
  }

  async #signal() {
    await this.page.evaluate(async () => {
      async function beep() {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        let osc = ctx.createOscillator();
        osc.connect(ctx.destination);
        osc.frequency.value = 900;
        osc.type = "sine";
        osc.start();
        osc.stop(ctx.currentTime + 1);
      }
      beep();
    });
  }
}

new LinkedinJobSearcher().init();
