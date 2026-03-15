import { HTTPSession } from './sigaa-http-session';
import { BondController } from './sigaa-bond-controller';
import { HTTP, SigaaHTTP } from './sigaa-http';
import { SigaaHTTPWithBond } from './sigaa-http-with-bond';
import { PageCacheWithBond } from './sigaa-page-cache-with-bond';
import { SigaaBrowserImpl } from './sigaa-browser';
import { URL } from 'url';

/**
 * @category Internal
 */
export interface HTTPFactory {
  createHttp(): HTTP;
  createHttpWithBond(bondSwitchUrl: URL): HTTP;
}

/**
 * Class responsible for creating a new http instance
 * @category Internal
 */
export class SigaaHTTPFactory implements HTTPFactory {
  constructor(
    private httpSession: HTTPSession,
    private pageCacheWithBond: PageCacheWithBond,
    private bondController: BondController,
    private sigaaBrowser: SigaaBrowserImpl
  ) {}

  createHttp(): HTTP {
    return new SigaaHTTP(this.httpSession, this.sigaaBrowser);
  }

  createHttpWithBond(bondSwitchUrl: URL): HTTP {
    return new SigaaHTTPWithBond(
      new SigaaHTTP(this.httpSession, this.sigaaBrowser),
      this.bondController,
      this.pageCacheWithBond,
      bondSwitchUrl
    );
  }
}
