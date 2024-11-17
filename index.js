require("dotenv").config();
const puppeteer = require("puppeteer");
const { permit, subPermit } = require("./myKeyWords.js");
const stopWordsInTitle = require("./stopWordsInTitle.js");
const { geoIds, keywords } = require("./searchUrls.js");
const tabooStates = require("./tabooStates.js");
const tabooCompanies = require("./tabooCompanies.js");
const { DB, CLIENT } = require("./db-client.js");

class LinkedinJobSearcher {
  constructor() {
    this.browser = null;
    this.page = null;
    this.table = null;
    this.potentialJobsTable = null;
    this.sentMessagesTable = null;
    this.unsentMessagesTable = null;
    this.modalHidden = false;
    // Time to fill out the form
    this.applyingTimeout = 10_000;
    this.emptyFieldsLimit = 0;
    this.minGrade = 4;
    this.headless = false;
    this.screenshotCounter = 0;
    this.startFrom = 0;
    this.generatedUrls = this.generateUrls();

    this.currentJobs = [];
  }

  generateUrls() {
    const urls = [];
    keywords.forEach((keyword) => {
      geoIds.forEach((id) => {
        urls.push(
          `https://www.linkedin.com/jobs/search/?distance=100&f_WT=2&geoId=${id}&keywords=${encodeURI(
            keyword
          )}&origin=JOB_SEARCH_PAGE_JOB_FILTER&refresh=true&sortBy=DD`
        );
      });
    });
    return urls;
  }

  async init() {
    await this.#startDB();
    this.browser = await puppeteer.launch({ headless: this.headless });
    this.page = (await this.browser.pages())[0];
    await this.page.setViewport({ width: 1000, height: 650 });
    await this.#setCurrentJobs();
    await this.#run();
  }

  async #startDB() {
    try {
      await CLIENT.connect();
      this.table = DB.collection("submitted_applications");
      this.potentialJobsTable = DB.collection("potential_jobs");
      this.sentMessagesTable = DB.collection("sent_messages");
      this.unsentMessagesTable = DB.collection("unsent_messages");
    } catch (err) {
      console.log("Error DB connect", err);
    }
  }

  async #run() {
    await this.#login();
    await this.#mapSearchUrls();
    await this.browser.close();
  }

  async #clickConnectionBtn(page, btnsList) {
    let connectionBtnFinded = false;
    for (const btn of btnsList) {
      const textContent = await page.evaluate((e) => e.textContent.trim(), btn);
      if (textContent == "Connect") {
        await btn.click();
        connectionBtnFinded = true;
        break;
      }
    }
    return connectionBtnFinded;
  }

  async #sendMessage(jobLink) {
    // Find heirer link
    const heirer = await this.page.$(".hirer-card__hirer-information");
    if (!heirer) {
      return;
    }
    const link = await this.page.evaluate(
      (e) => e.querySelector("a.app-aware-link").href,
      heirer
    );
    // Go to heirer page
    const page = await this.browser.newPage();
    await page.goto(link);
    // Find and click on connection btn
    const btnsSelector = ".artdeco-card .pvs-profile-actions__action";
    const ddSelector = `${btnsSelector}.artdeco-dropdown__trigger--placement-bottom`;
    await page.waitForSelector(ddSelector);
    let btnFinded = await this.#clickConnectionBtn(
      page,
      await page.$$(btnsSelector)
    );
    if (!btnFinded) {
      await page.click(ddSelector);
      const ddBtnsSelector = `${ddSelector} + .artdeco-dropdown__content .artdeco-dropdown__item span`;
      const ddBtns = await page.$$(ddBtnsSelector);
      await new Promise((resolve) => setTimeout(resolve, 500));
      btnFinded = await this.#clickConnectionBtn(page, ddBtns);
    }
    if (!btnFinded) {
      await this.page.bringToFront();
      await page.close();
      return;
    }
    // Assept modal
    try {
      await page.waitForSelector(
        "#artdeco-modal-outlet .artdeco-button--secondary"
      );
    } catch (err) {
      console.error(err);
      await this.page.bringToFront();
      await page.close();
      return;
    }
    await page.click("#artdeco-modal-outlet .artdeco-button--secondary");
    await page.waitForSelector("#artdeco-modal-outlet label");
    // Paste text
    await page.evaluate(
      (e) =>
        (e.value = `Hello,
Thank you for connecting!
My name is Viktor, and I have been working as a Frontend Developer since 2017. I am currently seeking new career opportunities and noticed that you are looking for a developer with experience similar to mine.
Looking forward to our conversation!
Best regards, Viktor`),
      await page.$("#custom-message")
    );
    // Waiting for user event
    await this.#signal();
    try {
      await page.evaluate(() => {
        return new Promise((resolve) => {
          document
            .querySelector(".connect-button-send-invite__custom-message-box")
            .addEventListener("click", resolve);
        });
      });
      await new Promise((resolve) => setTimeout(resolve, 3000));
    } catch (err) {
      console.error(err);
      await this.page.bringToFront();
      await page.close();
      return;
    }
    // Send message
    await page.waitForSelector(
      "#artdeco-modal-outlet .artdeco-button--primary"
    );
    await page.click("#artdeco-modal-outlet .artdeco-button--primary");
    const heirerName = await page.evaluate(
      (e) => e.textContent.trim(),
      await page.$(".artdeco-card h1")
    );
    await this.sentMessagesTable.insertOne({
      jobLink,
      heirerName,
    });
    await this.page.bringToFront();
    await page.close();
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

  async #setCurrentJobs() {
    const get = await this.potentialJobsTable.find().toArray();
    this.currentJobs = get;
  }

  async #mapSearchUrls() {
    for (let i = this.startFrom; i < this.generatedUrls.length; i++) {
      await this.#visitSearchPage(this.generatedUrls[i]);
      await this.#scrollJobsList();
      await this.#findingSulitableVacancies(i);
    }
  }

  #progress(url, title, linkIterator) {
    const urlParams = new URL(url).searchParams;
    process.stdout.clearLine();
    process.stdout.cursorTo(0);
    process.stdout.write(
      `${linkIterator}; ${urlParams.get("location")}; ${urlParams.get(
        "keywords"
      )}; ${urlParams.get("start")}; ${title}`
    );
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

  async #getTitle(job) {
    let title = await this.page.evaluate(
      (e) =>
        e.querySelector(".job-card-container__link").getAttribute("aria-label"),
      job
    );
    if (title.includes(" with verification")) {
      title = title.split(" with verification")[0];
    }
    return title;
  }

  async #getDescription() {
    let description = "";

    try {
      description = await this.page.evaluate(
        (e) => e.textContent.replace("\n", "").trim(),
        await this.page.$(
          ".job-details-jobs-unified-top-card__primary-description-container"
        )
      );
    } catch (error) {
      console.log(error);
      // this.page.screenshot({
      //   path: `screenshots-linkedin/error-description-textContent.png`,
      // });
      // console.log(`Cannot find description ${this.page.url()}`);
    }

    return description;
  }

  async #getCompanyName(description) {
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
    return companyName;
  }

  async #findingSulitableVacancies(linkIterator) {
    const openedChat = await this.page.$(".msg-convo-wrapper");
    if (openedChat) {
      const inner = await openedChat.$(
        '.artdeco-button__icon[data-test-icon="close-small"]'
      );
      if (inner) {
        await inner.click();
      }
    }
    // List of loaded vacancies
    const jobs = await this.page.$$(
      ".scaffold-layout__list-container .ember-view.jobs-search-results__list-item:not(.jobs-search-results__job-card-search--generic-occludable-area)"
    );

    // Iterating through vacancies
    for (const job of jobs) {
      // Skip if applied or viewed
      const footerSelector = await job.$(
        ".job-card-list__footer-wrapper.job-card-container__footer-wrapper"
      );
      if (footerSelector) {
        const footerText = await this.page.evaluate(
          (e) => e.textContent.toLowerCase(),
          footerSelector
        );
        if (footerText.includes("applied") || footerText.includes("viewed")) {
          continue;
        }
      }
      // Declare job title
      const title = await this.#getTitle(job);

      // Skip if title has stopWords
      const stopWordIncludes = stopWordsInTitle.some((r) =>
        title.toLowerCase().includes(r.toLowerCase())
      );
      if (stopWordIncludes) {
        continue;
      }
      // Click on the vacancy
      try {
        await job.click();
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        console.log(error);
        // console.log(`Click error to job "${this.page.url()}"`);
        // this.page.screenshot({ path: `screenshots-linkedin/job-click-error.png` });
        continue;
      }

      // Wait for it to load
      try {
        try {
          await this.page.waitForSelector(
            `.jobs-search__job-details--container[aria-label="${title}"]`,
            {
              timeout: 5000,
            }
          );
        } catch (errorOne) {
          try {
            await this.page.waitForSelector(
              `.jobs-search__job-details--container[aria-label=" ${title}"]`,
              {
                timeout: 5000,
              }
            );
          } catch (errorTwo) {
            try {
              await this.page.waitForSelector(
                `.jobs-search__job-details--container[aria-label="${title} "]`,
                {
                  timeout: 5000,
                }
              );
            } catch (errorThree) {
              console.log(errorThree);
            }
          }
        }
        await this.page.waitForSelector(
          ".jobs-description-content__text span",
          {
            timeout: 10000,
          }
        );
      } catch (err) {
        console.log(err);
        await this.unsentMessagesTable.insertOne({
          jobUrl: await this.page.url(),
        });
        continue;
      }

      const description = await this.#getDescription();

      const tabooStatesIncludes = tabooStates.some((r) =>
        description.toLowerCase().includes(r.toLowerCase())
      );
      if (tabooStatesIncludes) {
        continue;
      }

      const companyName = await this.#getCompanyName(description);

      const tabooCompaniesIncludes = tabooCompanies.some((r) =>
        companyName.toLowerCase().includes(r.toLowerCase())
      );
      if (tabooCompaniesIncludes) {
        continue;
      }

      // // Skip if job is added
      // const currentJobsFinded = this.currentJobs.find(
      //   (o) => o.title == title && o.companyName == companyName
      // );

      // if (currentJobsFinded) {
      //   continue;
      // }

      this.#progress(`${this.page.url()}`, title, linkIterator);

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

      // Set full description
      const decriptionSelector = ".jobs-box__html-content";
      const fullDecription = await this.page.evaluate(
        (e) => e.textContent.replaceAll("\n", "").trim(),
        await this.page.$(decriptionSelector)
      );

      // Skip if description are not included all keyword
      const fullDecriptionLower = fullDecription.toLowerCase();

      let assignedGrade = 0;
      for (const p of permit) {
        const finded = p.some((r) =>
          fullDecriptionLower.includes(r.toLowerCase())
        );

        if (finded) {
          assignedGrade++;
        }
      }

      for (const p of subPermit) {
        const finded = p.some((r) =>
          fullDecriptionLower.includes(r.toLowerCase())
        );

        if (finded) {
          assignedGrade = Math.round((assignedGrade + 0.2) * 10) / 10;
        }
      }

      if (assignedGrade < this.minGrade) {
        continue;
      }

      // await this.#sendMessage(jobLink);

      // Skip if it's not a simple application submission
      const isEasyApply = await job.$$eval(
        `.job-card-container__apply-method`,
        (childs) => childs.length > 0
      );
      if (!isEasyApply) {
        const newRow = {
          title,
          companyName,
          description,
          jobLink,
          companyLink,
          fullDecription,
          isEasyApply,
          assignedGrade,
          date: new Date().toISOString(),
        };
        this.currentJobs.push(newRow);
        await this.potentialJobsTable.insertOne(newRow);
        continue;
      } else {
        // Skip if there is no button for simple submission in the description
        const applyBtn = await this.page.$(
          ".jobs-details__main-content .relative .jobs-apply-button"
        );
        if (!applyBtn) {
          continue;
        }
        // Check error message
        const applyBtnError = await this.page.$(
          ".artdeco-inline-feedback--error"
        );

        if (applyBtnError) {
          const isDisabled = await this.page.$eval(
            ".jobs-details__main-content .relative .jobs-apply-button",
            (button) => (button && button.disabled) || null
          );
          if (isDisabled) {
            return;
          }
          continue;
        }
        await applyBtn.click();
        if (this.modalHidden) {
          await this.page.evaluate(
            (e) => (e.style.display = "block"),
            await this.page.$("#artdeco-modal-outlet")
          );
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
        const preApplyForm = await this.page.$(
          ".job-details-pre-apply-safety-tips-modal__content"
        );
        if (preApplyForm) {
          await this.#onClick(".artdeco-modal button.jobs-apply-button");
        }

        // Go through the pre-filled form as much as possible
        const modal = ".jobs-easy-apply-modal";
        try {
          await this.page.waitForSelector(
            `${modal} .jobs-easy-apply-form-section__grouping`,
            {
              visible: true,
              timeout: 5000,
            }
          );
        } catch (error) {
          console.log(error);
          await this.page.evaluate(
            (e) => (e.style.display = "none"),
            await this.page.$("#artdeco-modal-outlet")
          );
          continue;
          // const modalSelector = await this.page.$(
          //   ".artdeco-modal.artdeco-modal--layer-default"
          // );
          // if (modalSelector) {
          //   await this.#onClick(
          //     `.artdeco-modal.artdeco-modal--layer-default .jobs-s-apply .jobs-apply-button.artdeco-button.artdeco-button--primary`
          //   );
          // }
        }

        await this.#nextFromStep();

        const formError = await this.page.$(
          `.jobs-easy-apply-modal .artdeco-inline-feedback--error`
        );

        if (!formError) {
          try {
            await this.page.waitForSelector(
              `.artdeco-modal.artdeco-modal--layer-default h2#post-apply-modal`,
              {
                visible: true,
                timeout: 5000,
              }
            );

            // Close the modal
            await this.#onClick(
              `.artdeco-modal.artdeco-modal--layer-default .ember-view.artdeco-modal__dismiss`
            );
          } catch (error) {
            console.log(error);
            continue;
          }
        } else {
          // If the form is not filled within the specified time, try to close it
          await this.#onClick(
            `.artdeco-modal.artdeco-modal--layer-default .ember-view.artdeco-modal__dismiss`
          );
          await this.#onClick(
            `.artdeco-button--secondary.artdeco-modal__confirm-dialog-btn`
          );

          const newRow = {
            title,
            companyName,
            description,
            jobLink,
            companyLink,
            fullDecription,
            isEasyApply,
            assignedGrade,
            date: new Date().toISOString(),
          };
          this.currentJobs.push(newRow);
          await this.potentialJobsTable.insertOne(newRow);
          continue;
        }

        // Record the vacancy in the db table
        await this.table.insertOne({
          title,
          companyName,
          description,
          jobLink,
          companyLink,
          date: new Date().toISOString(),
        });
      }
    }

    await this.#paginationEnds(linkIterator);
  }

  async #nextFromStep() {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const primaryButtonSelector = `.jobs-easy-apply-modal .jobs-easy-apply-content footer button.artdeco-button--primary`;
    const primaryButton = await this.page.$(primaryButtonSelector);

    if (!primaryButton) {
      return;
    } else {
      await this.#onClick(primaryButtonSelector);
    }

    const vmlPrim = (await this.page.$$(`.artdeco-inline-feedback__message`))
      .length;

    try {
      if (vmlPrim == 1) {
        const errorMsg = await this.page.evaluate(
          (e) => e.textContent.replaceAll("\n", "").trim(),
          await this.page.$(`.artdeco-inline-feedback__message`)
        );
        if (errorMsg.includes("Select checkbox to proceed")) {
          await this.page.click(
            'fieldset[id^="checkbox-form-component"] label'
          );
          return await this.#nextFromStep();
        }
      }
    } catch (error) {
      console.log(error);
      console.log("error");
    }

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
      return await this.#nextFromStep();
    }
  }

  async #paginationEnds(linkIterator) {
    const nextPage = await this.page.$(
      `.artdeco-pagination__indicator.selected + .artdeco-pagination__indicator`
    );

    if (nextPage) {
      await nextPage.click();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await this.#scrollJobsList();
      await this.#findingSulitableVacancies(linkIterator);
    }
  }

  async #signal() {
    await this.page.evaluate(async () => {
      async function beep() {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        let osc = ctx.createOscillator();
        osc.connect(ctx.destination);
        osc.frequency.value = 200;
        osc.type = "sine";
        osc.start();
        osc.stop(ctx.currentTime + 1);
      }
      beep();
    });
  }
}

new LinkedinJobSearcher().init();
