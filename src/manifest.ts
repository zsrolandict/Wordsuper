/** Oldest Word API the add-in works with: comments and the Track Changes mode need WordApi 1.4 */
export const REQUIRED_WORD_API_VERSION = "1.4";

/**
 * Microsoft sign-in (Office single sign-on): Word gets tokens for this app registration. The Application ID URI must
 * be api://<the add-in's host>/<client ID>, the same as in the app registration's "Expose an API" page.
 */
export function webApplicationInfo(baseUrl: string, clientId: string): string {
  return `
    <WebApplicationInfo>
      <Id>${clientId}</Id>
      <Resource>api://${new URL(baseUrl).host}/${clientId}</Resource>
      <Scopes>
        <Scope>openid</Scope>
        <Scope>profile</Scope>
      </Scopes>
    </WebApplicationInfo>`;
}

/** ssoClientId: the app registration's client ID when the server uses Microsoft sign-in (AUTH_MODE) */
export function generateManifest(appUrl: string, ssoClientId?: string): string {
  // Ensure the URL doesn't have a trailing slash for consistency
  const baseUrl = appUrl.replace(/\/$/, '');
  
  // Generating a stable random GUID based on the URL (or just a fixed one for this project)
  // Own ID (not the one of the original word-add-in), so both versions can be installed side by side
  const guid = "65d98045-a095-4bc5-921a-95bff0ef2573";

  return `<?xml version="1.0" encoding="UTF-8"?>
<OfficeApp 
  xmlns="http://schemas.microsoft.com/office/appforoffice/1.1" 
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" 
  xmlns:bt="http://schemas.microsoft.com/office/officeappbasictypes/1.0" 
  xmlns:ov="http://schemas.microsoft.com/office/taskpaneappversionoverrides"
  xsi:type="TaskPaneApp">

  <!-- Basic Add-in Settings -->
  <Id>${guid}</Id>
  <Version>1.1.0.0</Version>
  <ProviderName>ICT Europa Legal</ProviderName>
  <DefaultLocale>en-US</DefaultLocale>
  <DisplayName DefaultValue="Word Writer (ICT Europa Legal)" />
  <Description DefaultValue="A helpful assistant right inside your Word document."/>
  
  <!-- Icons must be PNG (or JPG/GIF/BMP): desktop Word refuses a manifest with SVG icons -->
  <IconUrl DefaultValue="${baseUrl}/assets/icons/icon-32.png"/>
  <HighResolutionIconUrl DefaultValue="${baseUrl}/assets/icons/icon-64.png"/>

  <SupportUrl DefaultValue="${baseUrl}" />
  <AppDomains>
    <AppDomain>${baseUrl}</AppDomain>
  </AppDomains>

  <!-- Hosts supported by this Add-in -->
  <Hosts>
    <Host Name="Document" />
  </Hosts>

  <!-- Word API features the add-in relies on (comments, Track Changes mode: WordApi 1.4) -->
  <Requirements>
    <Sets DefaultMinVersion="1.1">
      <Set Name="WordApi" MinVersion="${REQUIRED_WORD_API_VERSION}" />
    </Sets>
  </Requirements>
  <DefaultSettings>
    <SourceLocation DefaultValue="${baseUrl}" />
  </DefaultSettings>

  <Permissions>ReadWriteDocument</Permissions>

  <!-- Task pane specific settings (VersionOverrides) -->
  <VersionOverrides xmlns="http://schemas.microsoft.com/office/taskpaneappversionoverrides" xsi:type="VersionOverridesV1_0">
    <Hosts>
      <Host xsi:type="Document">
        <DesktopFormFactor>
          <GetStarted>
            <Title resid="GetStarted.Title"/>
            <Description resid="GetStarted.Description"/>
            <LearnMoreUrl resid="GetStarted.LearnMoreUrl"/>
          </GetStarted>
          <ExtensionPoint xsi:type="PrimaryCommandSurface">
            <OfficeTab id="TabHome">
              <Group id="CommandsGroup">
                <Label resid="CommandsGroup.Label"/>
                <Icon>
                  <bt:Image size="16" resid="Icon.16x16"/>
                  <bt:Image size="32" resid="Icon.32x32"/>
                  <bt:Image size="80" resid="Icon.80x80"/>
                </Icon>
                <Control xsi:type="Button" id="TaskpaneButton">
                  <Label resid="TaskpaneButton.Label"/>
                  <Supertip>
                    <Title resid="TaskpaneButton.Label"/>
                    <Description resid="TaskpaneButton.Tooltip"/>
                  </Supertip>
                  <Icon>
                    <bt:Image size="16" resid="Icon.16x16"/>
                    <bt:Image size="32" resid="Icon.32x32"/>
                    <bt:Image size="80" resid="Icon.80x80"/>
                  </Icon>
                  <Action xsi:type="ShowTaskpane">
                    <TaskpaneId>ButtonId1</TaskpaneId>
                    <SourceLocation resid="Taskpane.Url"/>
                  </Action>
                </Control>
              </Group>
            </OfficeTab>
          </ExtensionPoint>
        </DesktopFormFactor>
      </Host>
    </Hosts>
    
    <Resources>
      <bt:Images>
        <bt:Image id="Icon.16x16" DefaultValue="${baseUrl}/assets/icons/icon-16.png"/>
        <bt:Image id="Icon.32x32" DefaultValue="${baseUrl}/assets/icons/icon-32.png"/>
        <bt:Image id="Icon.80x80" DefaultValue="${baseUrl}/assets/icons/icon-80.png"/>
      </bt:Images>
      <bt:Urls>
        <bt:Url id="GetStarted.LearnMoreUrl" DefaultValue="${baseUrl}" />
        <bt:Url id="Taskpane.Url" DefaultValue="${baseUrl}" />
      </bt:Urls>
      <bt:ShortStrings>
        <bt:String id="GetStarted.Title" DefaultValue="Get started with Word Writer"/>
        <bt:String id="CommandsGroup.Label" DefaultValue="Word Writer"/>
        <bt:String id="TaskpaneButton.Label" DefaultValue="Word Writer"/>
      </bt:ShortStrings>
      <bt:LongStrings>
        <bt:String id="GetStarted.Description" DefaultValue="Your AI assistant inside Word is loaded."/>
        <bt:String id="TaskpaneButton.Tooltip" DefaultValue="Click to open the Word Writer Taskpane"/>
      </bt:LongStrings>
    </Resources>${ssoClientId ? webApplicationInfo(baseUrl, ssoClientId) : ''}
  </VersionOverrides>
</OfficeApp>`;
}
