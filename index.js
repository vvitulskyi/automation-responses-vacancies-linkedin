require("dotenv").config();
const puppeteer = require("puppeteer");
const myKeyWords = require("./myKeyWords.js");
const stopWordsInTitle = require("./stopWordsInTitle.js");
const allowedStates = require("./allowedStates.js");

class LinkedinJobSearcher {
  constructor() {
    this.browser = null;
    this.page = null;
    this.success = [];
    // Link to go to the search page
    this.searchUrl =
      "https://www.linkedin.com/jobs/collections/recommended/?discover=recommended&discoveryOrigin=JOBS_HOME_JYMBII";
    // Time to fill out the form
    this.applyingTimeout = 1_000;
    this.screenshotCounter = 0;
  }

  async init() {
    this.browser = await puppeteer.launch({ headless: false });
    this.page = (await this.browser.pages())[0];
    await this.page.setViewport({ width: 1000, height: 650 });
    await this.#run();
  }

  async #run() {
    await this.#login();
    await this.#visitSearchPage();
    await this.#scrollJobsList();
    await this.#findingSulitableVacancies();
    await this.browser.close();
    console.log(this.success);
    console.log(this.success.length);
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

  async #onClick(selector) {
    try {
      await this.page.waitForSelector(selector);
      await this.page.click(selector);
    } catch (error) {
      this.page.screenshot({
        path: `screenshots-linkedin/onclick-error-${this.screenshotCounter}.png`,
      });
      console.log(
        `Selector "${selector}" not found (${this.screenshotCounter})`
      );
      this.screenshotCounter = this.screenshotCounter + 1;
    }
  }

  async #closeChat() {
    await this.#onClick(
      `.msg-overlay-list-bubble [data-test-icon="chevron-down-small"]`
    );
  }

  async #visitSearchPage() {
    await this.page.goto(this.searchUrl);
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

      const description = await this.page.evaluate(
        (e) => e.textContent.replace("\n", "").trim(),
        await this.page.$(
          ".job-details-jobs-unified-top-card__primary-description-without-tagline"
        )
      );
      const allowedStatesIncludes = allowedStates.some((r) =>
        description.toLowerCase().includes(r.toLowerCase())
      );
      if (!allowedStatesIncludes) {
        continue;
      }

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
      } catch (error) {
        console.log(`Click error to job "${title}"`);
        // this.page.screenshot({ path: `screenshots-linkedin/job-click-error.png` });
        continue;
      }
      // Wait for it to load
      await this.page.waitForSelector(".jobs-details__main-content");
      // Skip if there is no button for simple submission in the description
      const applyBtn = await this.page.$(
        ".jobs-details__main-content .relative .jobs-apply-button"
      );
      if (!applyBtn) {
        continue;
      }
      await applyBtn.click();

      // Go through the pre-filled form as much as possible
      const modal = ".jobs-easy-apply-modal";
      await this.page.waitForSelector(`${modal} .jobs-easy-apply-content`, {
        visible: true,
      });
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await this.#nextFromStep();

      try {
        // Expect the form to be filled within applyingTimeout
        await this.page.waitForSelector(
          `.artdeco-modal.artdeco-modal--layer-default h2#post-apply-modal`,
          { visible: true, timeout: this.applyingTimeout }
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
        ".job-details-jobs-unified-top-card__primary-description-without-tagline .app-aware-link"
      );
      let companyName = null;
      // Sometimes it might not be possible to find the company name
      // then use the description instead of the company
      if (companySelector) {
        companyName = await this.page.evaluate(
          (e) => e.textContent,
          companySelector
        );
      } else {
        companyName = description;
      }
      // Record the vacancy in the list of completed
      this.success.push({
        title,
        companyName,
        description,
      });
      console.log(this.success);
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
}

new LinkedinJobSearcher().init();
